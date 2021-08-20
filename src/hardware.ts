import * as TuyAPI from 'tuyapi';
import { poolData, webSocketServer } from "./main";
import { Data } from "./data";
import { Gpio } from "onoff";
import { tuya_secret } from "../tuya-secrets";

var pinConfig: Data.PinConfig = Data.load(new Data.PinConfig());

export namespace Hardware {
    export class PoolController {

        // keep timers and a quickdose timer
        private timers: NodeJS.Timeout[] = [];
        private quickDoseTimer: NodeJS.Timeout = null;
        private quickDoseTime: Data.Time = null;

        // GPIOs that control the devices
        private _chlorinePumpGPIO
        private _filterGPIO;
        private _heaterGPIO;

        constructor() {
            // Checks if the GPIO is accessible to prevent errors
            if (Gpio.accessible) {
                this._chlorinePumpGPIO = new Gpio(pinConfig.pool_chlorinePump, "out");
                this._filterGPIO = new Gpio(pinConfig.pool_filter, "out");
                this._heaterGPIO = new Gpio(pinConfig.pool_heater, "out");
            } else {
                console.error("Could not access GPIO");
                console.log("Setting up mock GPIO")

                this._chlorinePumpGPIO = new MockGPIO(pinConfig.pool_chlorinePump);
                this._filterGPIO = new MockGPIO(pinConfig.pool_filter);
                this._heaterGPIO = new MockGPIO(pinConfig.pool_heater);
            }

            // on SIGINT (Signal Interrupt / Ctrl + C) free all GPIOs resources (GPIO sysfs files)
            process.on("SIGINT", _ => {
                this._chlorinePumpGPIO.unexport();
                this._filterGPIO.unexport();
                this._heaterGPIO.unexport();

                process.kill(process.pid, 'SIGTERM')
            });

            // refresh Timers every 24 hours
            this.refreshTimers();
            this.applySchedules();
            setInterval(this.refreshTimers, 24 * 60 * 60 * 1000);
        }

        public chlorinateNow(dose_ml: number) {
            if (dose_ml < 16 || dose_ml > 23040) return;
            var stopTime = Data.doseToTime(dose_ml).add(Data.Time.now());
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
            if (!on) if(this.heaterOn || this.chlorineOn) return;
            this._filterGPIO.writeSync(on ? 1 : 0);
        }

        public get filterOn(): boolean {
            return Boolean(this._filterGPIO.readSync());
        }

        public set heaterOn(on: boolean) {
            if (on && !this.filterOn) this.filterOn = true;     // Turn filter on
            this._heaterGPIO.writeSync(on ? 1 : 0);             // send turn on signal to heater
            if (on && !this.filterOn) this.heaterOn = false;    //turn heater off if filter hasn't turned on

        }

        public get heaterOn(): boolean {
            return Boolean(this._heaterGPIO.readSync());
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

        // Starts the chlorine timers, and toggles the pump accordingly
        private startChlorineTimers() {
            // Start timers for each timeframe and adds them to the timer list
            poolData.getChlorineTimings().forEach((dose_ml: number, start: Data.Time) => {
                // Turn chlorine on
                this.timers.push(setTimeout(() => {
                    if (!poolData.chlorineScheduled) return;
                    this.filterOn = true;
                    this.chlorineOn = true
                    webSocketServer.updateClients();
                }, start.millisTill())); // Start time in ms

                // Turn chlorine off if it currently isn't quickdosing
                var stopTime = start.add(Data.doseToTime(dose_ml));
                this.timers.push(setTimeout(() => {
                    if (!poolData.chlorineScheduled) return;
                    if (this.quickDoseTimer === null) {
                        this.chlorineOn = false
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

        applySchedules() {
            // adjust state for current time
            if (!poolData.chlorineScheduled) return;
            if (poolData.isChlorineScheduled(Data.Time.now())) {
                this.filterOn = true;
                this.chlorineOn = true
            } else {
                this.chlorineOn = false
            }

            // adjust state for current time
            if (!poolData.heaterScheduled) return;
            if (poolData.isHeaterScheduled(Data.Time.now())) {
                this.filterOn = true;
                this.heaterOn = true;
            } else {
                this.heaterOn = false;
            }

            // adjust state for current time
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

    export class HotTubController { }

    export class HeatPumpController {

        constructor() {
            const device = new TuyAPI(tuya_secret);

            let stateHasChanged = false;

            // Find device on network
            device.find().then(() => {
                device.connect();
            });

            // Add event listeners
            device.on('connected', () => {
                console.log('Connected to device!');
            });

            device.on('disconnected', () => {
                console.log('Disconnected from device.');
            });

            device.on('error', error => {
                console.log('Error!', error);
            });

            device.on('data', data => {
                console.log('Data from device:', data);
            });

            // Disconnect after 10 seconds
            setTimeout(() => { device.disconnect(); }, 10000);
        }
    }

    class MockGPIO {
        on: boolean = false;
        pin: number;

        constructor(pin: number) {
            this.pin = pin;
        }

        public writeSync(binary: number) {
            this.on = (binary === 1);
            console.log(`Pin ${this.pin} is now turned ${this.on ? 'on' : 'off'}`)
        }

        public readSync(): number {
            return this.on ? 1 : 0;
        }

        public unexport() {
            console.log(`Unexported MockGPIO on pin ${this.pin}`)
        }
    }
}
