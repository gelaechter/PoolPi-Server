import { createServer, Server } from 'http';

export class WebServer {
    private httpServer: Server;

    private init() {
        this.httpServer = createServer(function (req, res) {
            if (req.url == '/data') {
                //check the URL of the current request
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.write(JSON.stringify({ message: 'Hello World' }));
                res.end();
            }
        });
    }

    public start() {
        this.httpServer.listen(5000);
    }
}
