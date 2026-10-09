"""Byte relay to DSH loopback inside a private evaluation sandbox.

The OpenSandbox API gates the outer endpoint; DSH still performs its own
token/Host/Origin checks. This relay neither reads credentials nor edits HTTP.
"""
import asyncio


async def client(reader, writer):
    upstream = None
    try:
        remote, upstream = await asyncio.open_connection('127.0.0.1', 3080)
        async def copy(source, target):
            while chunk := await source.read(65536):
                target.write(chunk)
                await target.drain()
        done, pending = await asyncio.wait([
            asyncio.create_task(copy(reader, upstream)),
            asyncio.create_task(copy(remote, writer)),
        ], return_when=asyncio.FIRST_COMPLETED)
        for task in pending:
            task.cancel()
        await asyncio.gather(*done, *pending, return_exceptions=True)
    finally:
        writer.close()
        await writer.wait_closed()
        if upstream:
            upstream.close()
            await upstream.wait_closed()


async def main():
    server = await asyncio.start_server(client, '0.0.0.0', 3081)
    async with server:
        await server.serve_forever()


if __name__ == '__main__':
    asyncio.run(main())
