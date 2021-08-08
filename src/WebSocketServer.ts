const WebSocket = require('ws');
import { Data } from './data';
import { Hardware } from './hardware';
import { poolController, poolData } from './main';

export class WebSocketServer {
    //All the socket connections
    private sockets = [];

    //sets up the server and starts it
    public start() {
        const server = new WebSocket.Server({
            port: 8080,
        });

        server.on('connection', function (socket) {
            this.sockets.push(socket);

            // When you receive a message, send that message to every socket.
            this.socket.on('message', (msg) => this.onMessage(msg));

            // When a socket closes, or disconnects, remove it from the array.
            this.socket.on('close', function () {
                this.sockets = this.sockets.filter((s) => s !== socket);
            });
        });
    }

    //called every time the server receives a message
    private onMessage(message: string) {
        var data: WebSocketData = Data.fromJSON(message);
        switch (data.key) {
            case PoolKeys.CHLORINE_ON:
                poolController.chlorinePumpOn = data.JSON;
                break;
            case PoolKeys.HEATER_ON: //special case, heater must not run without heater
                poolController.heaterOn = data.JSON;
                if (data.JSON === true) poolController.filterOn = true;
                break;
            case PoolKeys.FILTER_ON:
                poolController.filterOn = data.JSON;
                break;
            case PoolKeys.CHLORINE_SCHEDULED:
                poolData.chlorineScheduled = data.JSON;
                Data.save(poolData);
                break;
            case PoolKeys.FILTER_SCHEDULED:
                poolData.filterScheduled = data.JSON;
                Data.save(poolData);
                break;
            case PoolKeys.HEATER_SCHEDULED:
                poolData.heaterScheduled = data.JSON;
                Data.save(poolData);
                break;
            case PoolKeys.CHLORINE_TIMINGS:
                poolData.addChlorineTiming(data.JSON[0], data.JSON[1]);
                Data.save(poolData);
                break;
            case PoolKeys.FILTER_TIMINGS:
                poolData.addFilterTiming(data.JSON[0], data.JSON[1]);
                Data.save(poolData);
                break;
            case PoolKeys.HEATER_TIMINGS:
                poolData.addHeaterTiming(data.JSON[0], data.JSON[1]);
                Data.save(poolData);
                break;
        }
        poolController.refreshTimers();
    }

    //function that updates the
    private update() {
        this.sockets.forEach((s) => s.send('kekw'));
    }
}

// Data that will be transported over the socket
class WebSocketData {
    public key: PoolKeys;
    public JSON: any;
}

// an enum containing all the keys for the WebSocket communication
enum PoolKeys {
    CHLORINE_ON,
    HEATER_ON,
    FILTER_ON,
    CHLORINE_SCHEDULED,
    HEATER_SCHEDULED,
    FILTER_SCHEDULED,
    CHLORINE_TIMINGS,
    HEATER_TIMINGS,
    FILTER_TIMINGS,
}

enum HotTubKeys { }

enum EtcKeys {
    ERROR,
    LOG,
    GPIO,
    PIN,
}
