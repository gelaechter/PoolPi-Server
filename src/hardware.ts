import * as TuyAPI from "tuyapi";
import { configData, poolData, webSocketServer } from "./main";
import * as Data from "./data";
import { Gpio } from "onoff";
import { tuya_secret } from "../tuya-secrets";
import * as ds18b20 from "ds18b20";
export class PoolController {

    // keep timers and a quickdose timer
    private timers: NodeJS.Timeout[] = [];
    private quickDoseTimer: NodeJS.Timeout = null;
    private quickDoseTime: Data.Time = null;

    // GPIOs that control the devices
    private _chlorinePumpGPIO;
    private _filterGPIO;
    private _heaterGPIO;
    private _valveGPIO;
    private _heaterPumpGPIO; // HotTub only

    // Is the heater controlled by the temperature sensor
    private _temperatureControl: boolean = true;

    // Sensors
    public sensorIds = [];
    public sensorTemps = { water: 0, cabin: 0, barrel: 0 };


    constructor() {
        this.updateGPIO();

        // on SIGINT (Signal Interrupt / Ctrl + C) free all GPIOs resources (GPIO sysfs files)
        process.on("SIGINT", _ => {
            this._chlorinePumpGPIO.unexport();
            this._filterGPIO.unexport();
            this._heaterGPIO.unexport();
            this._heaterGPIO?.unexport();

            process.kill(process.pid, "SIGTERM");
        });

        // refresh Timers every 24 hours
        this.refreshTimers();
        this.applySchedules();
        setInterval(this.refreshTimers, 24 * 60 * 60 * 1000);
    }

    public updateGPIO() {
        console.log('Updating GPIO');
        // Checks if the GPIO is accessible to prevent errors
        const access = Gpio.accessible;
        if (!access)
            console.info("Could not access GPIO: Setting up mock GPIO");

        if (configData.poolMode) {
            this._chlorinePumpGPIO = access ?
                new Gpio(configData.gPoolChlorinePump, "out") :
                new MockGPIO(configData.gPoolChlorinePump);
            this._filterGPIO = access ?
                new Gpio(configData.gPoolFilter, "out") :
                new MockGPIO(configData.gPoolFilter);
            this._heaterGPIO = access ?
                new Gpio(configData.gPoolHeater, "out") :
                new MockGPIO(configData.gPoolHeater);
        } else {
            this._chlorinePumpGPIO = access ?
                new Gpio(configData.gHotTubChlorinePump, "out") :
                new MockGPIO(configData.gHotTubChlorinePump);
            this._filterGPIO = access ?
                new Gpio(configData.gHotTubFilter_UV, "out") :
                new MockGPIO(configData.gHotTubFilter_UV);
            this._heaterGPIO = access ?
                new Gpio(configData.gHotTubHeater, "out") :
                new MockGPIO(configData.gHotTubHeater);
            this._heaterPumpGPIO = access ?
                new Gpio(configData.gHotTubHeaterPump, "out") :
                new MockGPIO(configData.gHotTubHeaterPump);
        }
        this._valveGPIO = access ? new Gpio(configData.gValve, "out") : new MockGPIO(configData.gValve);
    }

    public chlorinateNow(dose_ml: number) {
        if (dose_ml < 16 || dose_ml > 23040) return;
        const stopTime = Data.doseToTime(dose_ml).add(Data.Time.now());
        this.quickDoseTime = stopTime;
        this.filterOn = true;
        this.chlorineOn = true;

        // Return pump to current scheduled state
        this.quickDoseTimer = (setTimeout(() => {
            this.chlorineOn = poolData.isChlorineScheduled(stopTime);
            this.filterOn = poolData.isFilterScheduled(stopTime);
            this.quickDoseTimer = null;
            this.quickDoseTime = null;
            webSocketServer.updateClients();
        }, stopTime.fromNow().minutes * 60 * 1000)); // Stop time in ms
    }

    public set chlorineOn(on: boolean) {
        if (on && !this.filterOn) this.filterOn = true;     // Turn filter on
        this._chlorinePumpGPIO.writeSync(on ? 1 : 0);
        if (on && !this.filterOn) this.chlorineOn = false;    //turn chlorine off if filter hasn't turned on


        // If the pump is turned off, cancel any Quickdose
        if (!on && this.quickDoseTimer !== null) {
            clearTimeout(this.quickDoseTimer);
            this.quickDoseTimer = null;
            this.quickDoseTime = null;
        }
    }

    public get chlorineOn(): boolean {
        return Boolean(this._chlorinePumpGPIO.readSync());
    }

    public set filterOn(on: boolean) {
        if (!on) if (this.heaterOn || this.chlorineOn) return;
        this._filterGPIO.writeSync(on ? 1 : 0);
    }

    public get filterOn(): boolean {
        return Boolean(this._filterGPIO.readSync());
    }

    public set heaterOn(on: boolean) {
        if (configData.poolMode) {
            if (on && !this.filterOn) this.filterOn = true;     // Turn filter on
            this._heaterGPIO.writeSync(on ? 1 : 0);             // send turn on signal to heater
            if (on && !this.filterOn) this.heaterOn = false;    //turn heater off if filter hasn't turned on
        } else {
            this._heaterPumpGPIO.writeSync(on ? 1 : 0);
            this._heaterGPIO.writeSync(on ? 1 : 0);
            if (on && !Boolean(this._heaterPumpGPIO.readSync())) this.heaterOn = false;    //turn heater off if heater pump hasn't turned on
        }
    }

    public get heaterOn(): boolean {
        return Boolean(this._heaterGPIO.readSync());
    }

    public set temperatureControl(on: boolean) {
        this._temperatureControl = on;
    }

    public get temperatureControl(): boolean {
        return this._temperatureControl;
    }

    public refreshTimers() {
        // Stop and clear out all other timers
        this.timers.forEach(timer => clearTimeout(timer));
        this.timers.length = 0; //clear the timer array

        // Start new timers
        this.startChlorineTimers();
        this.startFilterTimers();
        this.startHeaterTimers();
    }

    private startSensorWatcher() {
        ds18b20.sensors((err, ids) => {
            if (err) console.error("Error while fetching sensors", err);
            this.sensorIds = ids;
        })

        setInterval(() => {
            this.sensorTemps.water = ds18b20.temperatureSync(configData.sensorIds.waterId || this.sensorIds[0])
            this.sensorTemps.barrel = ds18b20.temperatureSync(configData.sensorIds.barrelId || this.sensorIds[1])
            this.sensorTemps.cabin = ds18b20.temperatureSync(configData.sensorIds.cabinId || this.sensorIds[2])

            if (!this.temperatureControl) return;
            if (this.sensorTemps.water < poolData.goalTemperature - 2) {
                this.heaterOn = true;
            } else if (this.sensorTemps.water >= poolData.goalTemperature) {
                this.heaterOn = false;
            }
        }, configData.sensorPollRate * 1000);
    }

    // Starts the chlorine timers, and toggles the pump accordingly
    private startChlorineTimers() {
        // Start timers for each timeframe and adds them to the timer list
        poolData.getChlorineTimings().forEach((dose_ml: number, start: Data.Time) => {
            // Turn chlorine on
            this.timers.push(setTimeout(() => {
                if (!poolData.chlorineScheduled) return;
                this.filterOn = true;
                this.chlorineOn = true;
                webSocketServer.updateClients();
            }, start.millisTill())); // Start time in ms

            // Turn chlorine off if it currently isn't quickdosing
            const stopTime = start.add(Data.doseToTime(dose_ml));
            this.timers.push(setTimeout(() => {
                if (!poolData.chlorineScheduled) return;
                if (this.quickDoseTimer === null) {
                    this.chlorineOn = false;
                    this.filterOn = poolData.isFilterScheduled(stopTime);
                }
                webSocketServer.updateClients();
            }, stopTime.millisTill())); // Stop time in ms
        });
    }

    // Starts the filter timers, and toggles the filter accordingly
    private startFilterTimers() {
        // Start timers for each timeframe and adds them to the timer list
        poolData.getFilterTimings().forEach((stop: Data.Time, start: Data.Time) => {
            // Turn filter on
            this.timers.push(setTimeout(() => {
                if (!poolData.filterScheduled) return;
                this.filterOn = true;
                webSocketServer.updateClients();
            }, start.millisTill())); // Start time in ms

            // Turn filter off if the heater isn't on
            this.timers.push(setTimeout(() => {
                if (!poolData.filterScheduled) return;
                if (!this.heaterOn && !this.chlorineOn) this.filterOn = false;
                webSocketServer.updateClients();
            }, stop.millisTill())); // Stop time in ms
        });


    }

    // Starts the filter timers, and toggles the heater accordingly
    private startHeaterTimers() {
        // Start timers for each timeframe and adds them to the timer list
        poolData.getHeaterTimings().forEach((stop: Data.Time, start: Data.Time) => {
            // Turn filter and heater on
            this.timers.push(setTimeout(() => {
                if (!poolData.heaterScheduled) return;
                this.filterOn = true;
                this.heaterOn = true;
                webSocketServer.updateClients();
            }, start.millisTill())); // Start time in ms

            // Turn heater off and filter too its scheduled state
            this.timers.push(setTimeout(() => {
                if (!poolData.heaterScheduled) return;
                this.filterOn = poolData.isFilterScheduled(stop);
                this.heaterOn = false;
                webSocketServer.updateClients();
            }, stop.millisTill())); // Stop time in ms
        });
    }

    // adjusts the gpio states for current time
    applySchedules() {
        // adjust state of chlorine
        if (!poolData.chlorineScheduled) return;
        if (poolData.isChlorineScheduled(Data.Time.now())) {
            this.filterOn = true;
            this.chlorineOn = true;
        } else {
            this.chlorineOn = false;
        }

        // adjust state of heater
        if (!poolData.heaterScheduled) return;
        if (poolData.isHeaterScheduled(Data.Time.now())) {
            this.filterOn = true;
            this.heaterOn = true;
        } else {
            this.heaterOn = false;
        }

        // adjust state of filter
        if (!poolData.filterScheduled) return;
        if (poolData.isFilterScheduled(Data.Time.now())) {
            this.filterOn = true;
        } else {
            if (!this.heaterOn && !this.chlorineOn) this.filterOn = false;
        }

        webSocketServer.updateClients();
    }

    getQuickDoseTime() {
        return this.quickDoseTime;
    }
}

export class HeatPumpController {

    constructor() {
        const device = new TuyAPI(tuya_secret);

        const stateHasChanged = false;

        // Find device on network
        // device.find().then(() => {
        //     device.connect();
        // });

        // Add event listeners
        device.on("connected", () => {
            console.log("Connected to device!");
        });

        device.on("disconnected", () => {
            console.log("Disconnected from device.");
        });

        device.on("error", error => {
            console.log("Error!", error);
        });

        device.on("data", data => {
            console.log("Data from device:", data);
        });

        // Disconnect after 10 seconds
        // setTimeout(() => { device.disconnect(); }, 10000);
    }
}

class MockGPIO {
    on = false;
    pin: number;

    constructor(pin: number) {
        this.pin = pin;
    }

    public writeSync(binary: number) {
        this.on = (binary === 1);
        console.log(`Pin ${this.pin} is now turned ${this.on ? "on" : "off"}`);
    }

    public readSync(): number {
        return this.on ? 1 : 0;
    }

    public unexport() {
        console.log(`Unexported MockGPIO on pin ${this.pin}`);
    }
}
