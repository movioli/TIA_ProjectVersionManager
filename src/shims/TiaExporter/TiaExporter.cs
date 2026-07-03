/**
 * TiaExporter.cs
 *
 * Standalone CLI shim that uses TIA Openness to export all PLC blocks from a
 * TIA Portal project snapshot as SimaticML XML files.
 *
 * Usage:
 *   TiaExporter.exe --project-file <path\to\project.ap19>
 *                   --output-dir   <path\to\output\dir>
 *                   --dll-path     <path\to\Siemens.Engineering.dll>
 *
 * Exit codes:
 *   0  success
 *   1  bad arguments / startup error
 *   2  TIA Portal launch or project open failure
 *   3  export failed (all blocks errored)
 *
 * Stdout — JSON lines (one per line, flushed immediately):
 *   {"type":"status","phase":"launch","message":"..."}
 *   {"type":"status","phase":"open","message":"..."}
 *   {"type":"status","phase":"scan","message":"..."}
 *   {"type":"status","phase":"export","message":"...","done":N,"total":M}
 *   {"type":"progress","block":"Main","done":N,"total":M}
 *   {"type":"file","path":"C:\\...\\OB\\Main.xml"}
 *   {"type":"done","exported":N,"errors":M}
 *
 * All diagnostic / error text goes to stderr and never to stdout.
 */

using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Text;

namespace TiaExporter
{
    class BlockInfo
    {
        public string  Name      { get; set; }
        public string  BlockType { get; set; }
        public object  Block     { get; set; }   // typed as object; cast to dynamic at call site
    }

    class Program
    {
        static Assembly _engAssembly;
        static Type     _softwareContainerType;
        static Type     _exportOptionsType;

        static int Main(string[] args)
        {
            string projectFile = null;
            string outputDir   = null;
            string dllPath     = null;

            for (int i = 0; i < args.Length - 1; i++)
            {
                switch (args[i])
                {
                    case "--project-file": projectFile = args[++i]; break;
                    case "--output-dir":   outputDir   = args[++i]; break;
                    case "--dll-path":     dllPath     = args[++i]; break;
                }
            }

            if (string.IsNullOrEmpty(projectFile) || string.IsNullOrEmpty(outputDir) || string.IsNullOrEmpty(dllPath))
            {
                Console.Error.WriteLine("ERROR: Missing required argument(s). Need --project-file, --output-dir, --dll-path");
                return 1;
            }
            if (!File.Exists(projectFile))
            {
                Console.Error.WriteLine($"ERROR: Project file not found: {projectFile}");
                return 1;
            }
            if (!File.Exists(dllPath))
            {
                Console.Error.WriteLine($"ERROR: Siemens.Engineering.dll not found: {dllPath}");
                return 1;
            }

            // ── Load Siemens.Engineering.dll at runtime ──────────────────────
            try
            {
                string dllDir = Path.GetDirectoryName(dllPath);

                // Register dependency resolver BEFORE loading the main DLL
                AppDomain.CurrentDomain.AssemblyResolve += (sender, e) =>
                {
                    string shortName = new AssemblyName(e.Name).Name;
                    string candidate = Path.Combine(dllDir, shortName + ".dll");
                    if (File.Exists(candidate))
                    {
                        Console.Error.WriteLine($"[resolve] {shortName}");
                        return Assembly.LoadFrom(candidate);
                    }
                    return null;
                };

                _engAssembly = Assembly.LoadFrom(dllPath);
                Console.Error.WriteLine($"[info] Loaded {Path.GetFileName(dllPath)} — {_engAssembly.GetName().Version}");

                // Load HMI DLL too if present
                string hmiDll = Path.Combine(dllDir, "Siemens.Engineering.Hmi.dll");
                if (File.Exists(hmiDll)) Assembly.LoadFrom(hmiDll);

                _softwareContainerType = _engAssembly.GetType("Siemens.Engineering.HW.Features.SoftwareContainer");
                _exportOptionsType     = _engAssembly.GetType("Siemens.Engineering.ExportOptions");

                if (_softwareContainerType == null)
                    throw new InvalidOperationException("Could not find SoftwareContainer type in the Openness DLL.");
                if (_exportOptionsType == null)
                    throw new InvalidOperationException("Could not find ExportOptions type in the Openness DLL.");
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"ERROR loading DLL: {ex.Message}");
                return 1;
            }

            try
            {
                return RunExport(projectFile, outputDir);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"ERROR during export: {ex}");
                return 3;
            }
        }

        // ── Main export logic ────────────────────────────────────────────────

        static int RunExport(string projectFile, string outputDir)
        {
            Type tiaPortalType     = _engAssembly.GetType("Siemens.Engineering.TiaPortal");
            Type tiaPortalModeType = _engAssembly.GetType("Siemens.Engineering.TiaPortalMode");

            if (tiaPortalType == null)
                throw new InvalidOperationException("TiaPortal type not found. Check DLL version.");

            WriteStatus("launch", "Launching TIA Portal (headless)…");

            object withoutUI = Enum.Parse(tiaPortalModeType, "WithoutUserInterface");
            dynamic tia = Activator.CreateInstance(tiaPortalType, withoutUI);

            try
            {
                WriteStatus("open", $"Opening project: {Path.GetFileName(projectFile)}…");

                dynamic project;
                try
                {
                    project = tia.Projects.Open(new FileInfo(projectFile));
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine($"ERROR opening project: {ex.Message}");
                    return 2;
                }

                WriteStatus("scan", "Scanning devices for PLC software…");

                var blocks = CollectAllBlocks(project);
                Console.Error.WriteLine($"[info] Collected {blocks.Count} blocks total");

                if (blocks.Count == 0)
                {
                    WriteStatus("scan", "No PLC blocks found in project.");
                    project.Close();
                    return 0;
                }

                int total  = blocks.Count;
                int done   = 0;
                int errors = 0;

                Directory.CreateDirectory(outputDir);

                // Use None (0) — WithDefaults inflates FBD blocks to 8 MB which breaks SACT's JS parser.
                object exportOptions;
                try   { exportOptions = Enum.Parse(_exportOptionsType, "None"); }
                catch { exportOptions = Enum.ToObject(_exportOptionsType, 0); }

                // Resolve Export(FileInfo, ExportOptions) via reflection ONCE.
                // We cannot use dynamic dispatch here because exportOptions is typed as
                // 'object' at the call site — the DLR cannot match it to the enum overload.
                MethodInfo exportMethod = blocks[0].Block.GetType()
                    .GetMethod("Export", new Type[] { typeof(FileInfo), _exportOptionsType });

                if (exportMethod == null)
                {
                    // Fallback: find any Export method with 2 parameters (no LINQ — avoids CS1977 lambda-in-dynamic-context error)
                    foreach (var m in blocks[0].Block.GetType().GetMethods(BindingFlags.Public | BindingFlags.Instance))
                    {
                        if (m.Name == "Export" && m.GetParameters().Length == 2)
                        {
                            exportMethod = m;
                            break;
                        }
                    }
                }

                Console.Error.WriteLine($"[info] Export method: {exportMethod?.ToString() ?? "NOT FOUND"}");

                if (exportMethod == null)
                    throw new InvalidOperationException("Could not find Export(FileInfo, ExportOptions) on block type.");

                WriteStatus("export", $"Exporting {total} blocks…", done, total);

                foreach (var bi in blocks)
                {
                    string blockDir = Path.Combine(outputDir, SanitizeName(bi.BlockType));
                    Directory.CreateDirectory(blockDir);
                    string outFile  = Path.Combine(blockDir, SanitizeName(bi.Name) + ".xml");

                    try
                    {
                        // Use reflection invoke — bypasses dynamic binder overload resolution
                        // which fails when exportOptions is typed as 'object'.
                        exportMethod.Invoke(bi.Block, new object[] { new FileInfo(outFile), exportOptions });
                        WriteJson("file", new Dictionary<string, object> { ["path"] = outFile });
                    }
                    catch (Exception ex)
                    {
                        // Unwrap TargetInvocationException to get the real error
                        string msg = (ex is TargetInvocationException tie && tie.InnerException != null)
                            ? tie.InnerException.Message
                            : ex.Message;
                        Console.Error.WriteLine($"WARN: export failed for {bi.BlockType}/{bi.Name}: {msg}");
                        errors++;
                    }

                    done++;
                    WriteJson("progress", new Dictionary<string, object>
                    {
                        ["block"] = bi.Name,
                        ["done"]  = done,
                        ["total"] = total,
                    });

                    if (done % 5 == 0 || done == total)
                        WriteStatus("export", $"Exporting blocks…", done, total);
                }

                project.Close();

                WriteJson("done", new Dictionary<string, object>
                {
                    ["exported"] = done - errors,
                    ["errors"]   = errors,
                });

                return errors == total && total > 0 ? 3 : 0;
            }
            finally
            {
                try { tia.Dispose(); } catch { }
            }
        }

        // ── Device / block collection ────────────────────────────────────────

        static List<BlockInfo> CollectAllBlocks(dynamic project)
        {
            var result = new List<BlockInfo>();

            int deviceCount = 0;
            foreach (dynamic device in project.Devices)
            {
                deviceCount++;
                Console.Error.WriteLine($"[scan] Device: {device.Name}");
                foreach (dynamic item in device.DeviceItems)
                {
                    TryCollectFromDeviceItem((object)item, result);
                }
            }
            Console.Error.WriteLine($"[scan] Total devices: {deviceCount}");

            return result;
        }

        static void TryCollectFromDeviceItem(object item, List<BlockInfo> result)
        {
            // GetService<SoftwareContainer>() is a GENERIC method.
            // dynamic dispatch cannot call generic methods with a Type argument —
            // we MUST use reflection to make the closed generic and invoke it.
            object sw = InvokeGetService(item, _softwareContainerType);
            if (sw == null) return;

            Console.Error.WriteLine($"[scan]   Found SoftwareContainer on {item.GetType().Name}");

            object software;
            try   { software = ((dynamic)sw).Software; }
            catch { Console.Error.WriteLine("[scan]   .Software property threw"); return; }

            if (software == null)
            {
                Console.Error.WriteLine("[scan]   .Software is null");
                return;
            }

            Console.Error.WriteLine($"[scan]   Software type: {software.GetType().FullName}");

            // Only handle PlcSoftware — skip HMI etc.
            if (!software.GetType().FullName.Contains("Plc"))
            {
                Console.Error.WriteLine("[scan]   Skipping non-PLC software");
                return;
            }

            // ── Compile the PLC before export ────────────────────────────────
            // TIA Openness can only export blocks that have been compiled.
            // Uncompiled blocks produce empty or incomplete XML.
            CompilePlcSoftware(software);

            try
            {
                dynamic plc = software;
                CollectFromBlockGroup(plc.BlockGroup, result, 0);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[scan]   BlockGroup access failed: {ex.Message}");
            }
        }

        /// <summary>
        /// Compiles the PLC software via ICompilable.Compile() before export.
        /// TIA Openness requires a successful compile to export all block types.
        /// Failure is non-fatal — we warn and continue.
        /// </summary>
        static void CompilePlcSoftware(object plcSoftware)
        {
            Type compilableType = _engAssembly.GetType("Siemens.Engineering.Compiler.ICompilable");
            if (compilableType == null)
            {
                Console.Error.WriteLine("[compile] ICompilable type not found — skipping compile step");
                return;
            }

            object compilable = InvokeGetService(plcSoftware, compilableType);
            if (compilable == null)
            {
                // PlcSoftware itself may implement ICompilable directly — try calling Compile() on it
                Console.Error.WriteLine("[compile] GetService<ICompilable> returned null, trying direct Compile()");
                compilable = plcSoftware;
            }

            WriteStatus("compile", "Compiling PLC software…");

            try
            {
                // Find Compile() method on the compilable object
                MethodInfo compileMethod = null;
                foreach (var m in compilable.GetType().GetMethods(BindingFlags.Public | BindingFlags.Instance))
                {
                    if (m.Name == "Compile" && m.GetParameters().Length == 0)
                    {
                        compileMethod = m;
                        break;
                    }
                }

                if (compileMethod == null)
                {
                    Console.Error.WriteLine("[compile] Compile() method not found — skipping");
                    return;
                }

                object result = compileMethod.Invoke(compilable, null);

                // Try to read the compiler result state
                if (result != null)
                {
                    try
                    {
                        dynamic r = result;
                        Console.Error.WriteLine($"[compile] Result: State={r.State}, ErrorCount={r.ErrorCount}, WarningCount={r.WarningCount}");
                    }
                    catch
                    {
                        Console.Error.WriteLine($"[compile] Compile returned: {result}");
                    }
                }

                WriteStatus("compile", "Compile finished.");
            }
            catch (Exception ex)
            {
                string msg = (ex is TargetInvocationException tie && tie.InnerException != null)
                    ? tie.InnerException.Message : ex.Message;
                Console.Error.WriteLine($"[compile] WARNING: compile failed: {msg} — continuing with export");
            }
        }

        /// <summary>
        /// Invokes the generic method GetService&lt;T&gt;() on target via reflection.
        /// This is necessary because dynamic dispatch cannot resolve generic methods by Type argument.
        /// </summary>
        static object InvokeGetService(object target, Type serviceType)
        {
            try
            {
                MethodInfo genericDef = null;
                foreach (var m in target.GetType().GetMethods(BindingFlags.Public | BindingFlags.Instance))
                {
                    if (m.Name == "GetService" && m.IsGenericMethodDefinition && m.GetParameters().Length == 0)
                    {
                        genericDef = m;
                        break;
                    }
                }

                if (genericDef == null)
                {
                    Console.Error.WriteLine($"[warn] GetService<T>() not found on {target.GetType().Name}");
                    return null;
                }

                MethodInfo closed = genericDef.MakeGenericMethod(serviceType);
                return closed.Invoke(target, null);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[warn] GetService<SoftwareContainer> threw: {ex.Message}");
                return null;
            }
        }

        static void CollectFromBlockGroup(dynamic group, List<BlockInfo> result, int depth)
        {
            string indent = new string(' ', depth * 2);

            try
            {
                int count = 0;
                foreach (dynamic block in group.Blocks)
                {
                    try
                    {
                        string name     = (string)block.Name;
                        // FullName gives e.g. "Siemens.Engineering.SW.Blocks.FC"
                        // Take the last segment as the block type label
                        string fullName = block.GetType().FullName ?? "";
                        string typeName = fullName.Contains(".")
                            ? fullName.Substring(fullName.LastIndexOf('.') + 1)
                            : fullName;

                        Console.Error.WriteLine($"[scan] {indent}  Block: {typeName}/{name}");
                        result.Add(new BlockInfo { Name = name, BlockType = typeName, Block = block });
                        count++;
                    }
                    catch (Exception ex)
                    {
                        Console.Error.WriteLine($"[scan] {indent}  Block read error: {ex.Message}");
                    }
                }
                Console.Error.WriteLine($"[scan] {indent}Group has {count} blocks");
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[scan] {indent}Blocks enumeration failed: {ex.Message}");
            }

            try
            {
                foreach (dynamic sub in group.Groups)
                {
                    Console.Error.WriteLine($"[scan] {indent}SubGroup: {sub.Name}");
                    CollectFromBlockGroup(sub, result, depth + 1);
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[scan] {indent}Groups enumeration failed: {ex.Message}");
            }
        }

        // ── Output helpers ───────────────────────────────────────────────────

        static readonly object _lock = new object();

        static void WriteStatus(string phase, string message, int done = 0, int total = 0)
        {
            var fields = new Dictionary<string, object>
            {
                ["phase"]   = phase,
                ["message"] = message,
            };
            if (total > 0) { fields["done"] = done; fields["total"] = total; }
            WriteJson("status", fields);
        }

        static void WriteJson(string type, Dictionary<string, object> fields)
        {
            var sb = new StringBuilder("{");
            sb.Append($"\"type\":\"{type}\"");
            foreach (var kv in fields)
            {
                sb.Append(',');
                sb.Append($"\"{kv.Key}\":");
                switch (kv.Value)
                {
                    case string s:
                        sb.Append('"').Append(s.Replace("\\", "\\\\").Replace("\"", "\\\"")).Append('"');
                        break;
                    default:
                        sb.Append(kv.Value ?? "null");
                        break;
                }
            }
            sb.Append('}');

            lock (_lock)
            {
                Console.WriteLine(sb.ToString());
                Console.Out.Flush();
            }
        }

        static string SanitizeName(string name)
        {
            var invalid = Path.GetInvalidFileNameChars();
            var sb = new StringBuilder(name.Length);
            foreach (char c in name)
                sb.Append(Array.IndexOf(invalid, c) >= 0 ? '_' : c);
            return sb.ToString();
        }
    }
}
