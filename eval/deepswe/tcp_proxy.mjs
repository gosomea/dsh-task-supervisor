// Expose a container-local DSH Web Host through a loopback-only Docker port.
// The caller must publish this listener on 127.0.0.1, not a public interface.
import net from 'node:net'

const [listenPort, upstreamPort] = process.argv.slice(2).map(Number)
if (![listenPort, upstreamPort].every(port => Number.isInteger(port) && port > 0 && port <= 65535)) {
  throw new Error('Usage: node tcp_proxy.mjs <listen-port> <upstream-port>')
}

net.createServer((client) => {
  const upstream = net.connect(upstreamPort, '127.0.0.1')
  client.on('error', () => upstream.destroy())
  upstream.on('error', () => client.destroy())
  client.on('close', () => upstream.destroy())
  upstream.on('close', () => client.destroy())
  client.pipe(upstream)
  upstream.pipe(client)
}).listen(listenPort, '0.0.0.0')
