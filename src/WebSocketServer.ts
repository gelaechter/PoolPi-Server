const WebSocket = require('ws');
import { config } from 'process';
import * as Data from './data';
import { PoolData } from './data';
import { poolController, poolData, configData } from './main';

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
        var jsonData = Data.fromJSON(message as string);
        console.log("Received websocket data:", jsonData);

        switch (jsonData.key) {

            case Keys.POOLDATA:
                //  essentially: poolCommands.command(args);
                new PoolCommands()[jsonData.command](...jsonData.args);
                if (jsonData.command.includes("Time")) {
                    poolController.refreshTimers();
                    poolController.applySchedules();
                }
                poolData.save();
                poolController.refreshTimers();
                break;

            case Keys.CONFIGDATA:
                new ConfigCommands()[jsonData.command](...jsonData.args);
                configData.save();
                break;
        }

        this.updateClients();
    }

    // sends data to clients
    public updateClients() {
        this.sockets.forEach((s) => {
            // Config Data
            var configData = {
                key: Keys.CONFIGDATA.toString(),
                data: new ConfigSocketData()
            }
            s.send(Data.toJSON(configData));

            // Pool Data
            var poolData = {
                key: Keys.POOLDATA.toString(),
                data: new PoolSocketData()
            }
            s.send(Data.toJSON(poolData));
        });

    }
}


enum Keys {
    POOLDATA = "POOLDATA",
    CONFIGDATA = "CONFIGDATA",
    LOG = "LOG"
}

// Data that will be transported over the socket
class PoolSocketData {
    chlorineOn: boolean = poolController.chlorineOn;
    filterOn: boolean = poolController.filterOn;
    heaterOn: boolean = poolController.heaterOn;

    goalTemperature: number = poolData.goalTemperature;

    chlorineScheduled: boolean = poolData.chlorineScheduled;
    heaterScheduled: boolean = poolData.heaterScheduled;
    filterScheduled: boolean = poolData.filterScheduled;

    chlorineTimings: Map<Data.Time, number> = poolData.getChlorineTimings();
    heaterTimings: Map<Data.Time, Data.Time> = poolData.getHeaterTimings();
    filterTimings: Map<Data.Time, Data.Time> = poolData.getFilterTimings();

    quickDoseTime: Data.Time = poolController.getQuickDoseTime();
    doses: number[] = poolData.doses;
}

// Commands that can be execute from the clientside
class PoolCommands {
    heaterOn = (on: boolean) => poolController.heaterOn = on;
    filterOn = (on: boolean) => poolController.filterOn = on;
    chlorineOn = (on: boolean) => poolController.chlorineOn = on;

    setGoalTemp = (temp: number) => poolData.goalTemperature = temp;

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

class ConfigSocketData {
    poolMode: boolean = configData.poolMode;;

    gPoolChlorinePump: number = configData.gPoolChlorinePump;
    gPoolFilter: number = configData.gPoolFilter;
    gPoolHeater: number = configData.gPoolHeater;
    gHotTubHeater_Pump: number = configData.gHotTubHeaterPump;
    gHotTubFilter_UV: number = configData.gHotTubFilter_UV;
    gHotTubChlorinePump: number = configData.gHotTubChlorinePump;
    gTempSensors: number = configData.gTempSensors;

    sensorPollRate: number = configData.sensorPollRate;
    public sensorIds: { waterId: string, cabinId: string, barrelId: string }
        = configData.sensorIds;
}

class ConfigCommands {
    switchMode = () => {
        poolData.save()
        configData.poolMode = !configData.poolMode;
        poolData.load();

        poolController.updateGPIO();
        poolController.refreshTimers();
        poolController.applySchedules();
    };

    gPoolChlorinePump = (pin: number) => configData.gPoolChlorinePump = pin;
    gPoolFilter = (pin: number) => configData.gPoolFilter = pin;
    gPoolHeater = (pin: number) => configData.gPoolHeater = pin;
    gHotTubHeater_Pump = (pin: number) => configData.gHotTubHeaterPump = pin;
    gHotTubFilter_UV = (pin: number) => configData.gHotTubFilter_UV = pin;
    gHotTubChlorinePump = (pin: number) => configData.gHotTubChlorinePump = pin;
    gTempSensors = (pin: number) => configData.gTempSensors = pin;
}

