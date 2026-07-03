const _listeners = {};

export function on(event, cb) {
  (_listeners[event] ??= []).push(cb);
}

export function off(event, cb) {
  _listeners[event] = (_listeners[event] || []).filter(f => f !== cb);
}

export function emit(event, data) {
  (_listeners[event] || []).forEach(cb => cb(data));
}
