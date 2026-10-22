// Used only by the local creation fixture, never by a hosted application.
const net = require('node:net');
const dns = require('node:dns');
const local = host => host == null || ['127.0.0.1', '::1', 'localhost'].includes(String(host));
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const host = typeof first === 'object' ? first.host : typeof args[1] === 'string' ? args[1] : undefined;
  if (!local(host)) throw new Error('Creation fixture blocks non-loopback socket egress');
  return connect.apply(this, args);
};
const lookup = dns.lookup;
dns.lookup = function (host, ...args) {
  if (!local(host)) throw new Error('Creation fixture blocks non-loopback DNS');
  return lookup.call(this, host, ...args);
};
const promiseLookup = dns.promises.lookup;
dns.promises.lookup = function (host, ...args) {
  if (!local(host)) throw new Error('Creation fixture blocks non-loopback DNS');
  return promiseLookup.call(this, host, ...args);
};
if (globalThis.fetch) {
  const fetch = globalThis.fetch;
  globalThis.fetch = function (input, options) {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (!local(url.hostname)) throw new Error('Creation fixture blocks non-loopback fetch');
    return fetch(input, options);
  };
}
