const WebSocket = require('ws');
import { Data } from './data';
import { poolController, poolData } from './main';

export class WebSocketServer {
    //All the socket connections
    private sockets: WebSocket[] = [];

    //sets up the server and starts it
    public start() {

        const server = new WebSocket.Server({
            port: 8081,
        });

        server.on('connection', (socket) => {
            this.sockets.push(socket);

            // When you receive a message, send that message to every socket.
            socket.on('message', (msg) => this.onMessage(msg));

            // When a socket closes, or disconnects, remove it from the array.
            socket.on('close', () => {
                this.sockets = this.sockets.filter((s) => s !== socket);
            });

            this.updateClients();
        });
    }

    //called every time the server receives a message
    private onMessage(message: string) {
        // Websocket Data always starts with a key and then the data itself
        var jsonData = JSON.parse(JSON.parse(message as string));
        switch (jsonData.key) {
            case Keys.POOLDATA:
                //  essentially: poolCommands.command(args);
                console.log("Received websocket data:" , jsonData);
                new PoolCommands()[jsonData.command](...jsonData.args);
                break;
            case Keys.HOTTUBDATA:
                break;
            case Keys.GPIO:
                break;
            case Keys.PIN:
                break;
        }
        Data.save(poolData);
        poolController.refreshTimers();
        this.updateClients();
    }

    // sends data to clients
    public updateClients() {
        this.sockets.forEach((s) => s.send(
            Data.toJSON({
                key: Keys.POOLDATA.toString(),
                data: new PoolSocketData()
            })
        ));
    }
}

// Data that will be transported over the socket
class PoolSocketData {
    chlorineOn: boolean;
    filterOn: boolean;
    heaterOn: boolean;

    chlorineScheduled: boolean;
    heaterScheduled: boolean;
    filterScheduled: boolean;

    chlorineTimings: Map<Data.Time, number>;
    heaterTimings: Map<Data.Time, Data.Time>;
    filterTimings: Map<Data.Time, Data.Time>;

    quickDoseTime: Data.Time;
    doses: number[]

    constructor() {
        this.chlorineOn = poolController.chlorineOn;
        this.filterOn = poolController.filterOn;
        this.heaterOn = poolController.heaterOn;

        this.chlorineScheduled = poolData.chlorineScheduled;
        this.heaterScheduled = poolData.heaterScheduled;
        this.filterScheduled = poolData.filterScheduled;

        this.chlorineTimings = poolData.getChlorineTimings();
        this.heaterTimings = poolData.getHeaterTimings();
        this.filterTimings = poolData.getFilterTimings();

        this.quickDoseTime = poolController.getQuickDoseTime();
        this.doses = poolData.doses;
    }

}

class HotTubSocketData { }

class PoolCommands {
    heaterOn = (on: boolean) => poolController.heaterOn = on;
    filterOn = (on: boolean) => poolController.filterOn = on;
    chlorineOn = (on: boolean) => poolController.chlorineOn = on;

    scheduleChlorine = (scheduled: boolean) => poolData.chlorineScheduled = scheduled;
    scheduleHeater = (scheduled: boolean) => poolData.heaterScheduled = scheduled;
    scheduleFilter = (scheduled: boolean) => poolData.filterScheduled = scheduled;

    addChlorineTime = (start: Data.Time, dose_ml: number) => poolData.addChlorineTiming(start, dose_ml);
    addHeaterTime = (start: Data.Time, stop: Data.Time) => poolData.addHeaterTiming(start, stop);
    addFilterTime = (start: Data.Time, stop: Data.Time) => poolData.addFilterTiming(start, stop);

    removeChlorineTime = (start: Data.Time) => poolData.removeChlorineTiming(start);
    removeHeaterTime = (start: Data.Time) => poolData.removeHeaterTiming(start);
    removeFilterTime = (start: Data.Time) => poolData.removeFilterTiming(start);

    quickDose = (dose_ml: number) => poolController.chlorinateNow(dose_ml);
    changeDoses = (doses: number[]) => poolData.doses = doses;
}

enum Keys {
    POOLDATA = "POOLDATA",
    HOTTUBDATA = "HOTTUBDATA",
    ERROR = "ERROR",
    LOG = "LOG",
    GPIO = "GPIO",
    PIN = "PIN",
}
