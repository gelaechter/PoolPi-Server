import * as TuyAPI from 'tuyapi';
import { poolData } from "./main";
import { Data } from "./data";
import { Gpio } from "onoff";
import { tuya_secret } from "../tuya-secrets";

var pinConfig: Data.PinConfig = Data.load(new Data.PinConfig());

export namespace Hardware {
    export class PoolController {

        private timers: NodeJS.Timeout[];
        private quickDoseTimer: NodeJS.Timeout;

        private _chlorinePumpGPIO
        private _filterGPIO;
        private _heaterGPIO;

        constructor() {
            // Checks if the GPIO is accessible to prevent errors
            if (Gpio.accessible) {
                this._chlorinePumpGPIO = new Gpio(pinConfig.pool_chlorinePump, "out");
                this._filterGPIO = new Gpio(pinConfig.pool_chlorinePump, "out");
                this._heaterGPIO = new Gpio(pinConfig.pool_chlorinePump, "out");
            } else {
                console.error("Could not access GPIO");
            }

            // on SIGINT (Signal Interrupt / Ctrl + C) free all GPIOs resources (GPIO sysfs files)
            process.on("SIGINT", _ => {
                this._chlorinePumpGPIO.unexport();
                this._filterGPIO.unexport();
                this._heaterGPIO.unexport();
            });

            setInterval(this.refreshTimers, 24 * 60 * 60 * 1000); // refresh Timers every 24 hours
        }

        public chlorinateNow(dosis_ml: number) {
            var stopTime = Data.doseToTime(dosis_ml);
            this.chlorinePumpOn = true;

            // Return pump to current scheduled state
            this.quickDoseTimer = (setTimeout(() => {
                this.chlorinePumpOn = poolData.isChlorineScheduled(stopTime)
                this.quickDoseTimer = null;
            }, stopTime.fromNow().minutes * 60 * 1000)); // Stop time in ms
        }

        public set chlorinePumpOn(on: boolean) {
            this._chlorinePumpGPIO.writeSync(on ? 1 : 0);

            // If the pump is turned off, cancel any Quickdose
            if (!on && this.quickDoseTimer !== null) {
                clearTimeout(this.quickDoseTimer);
                this.quickDoseTimer = null;
            }
        }

        public get chlorinePumpOn(): boolean {
            return Boolean(this._chlorinePumpGPIO.readSync());
        }

        public set filterOn(on: boolean) {
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
            for (const timeout of this.timers) {
                clearTimeout(timeout);
            }
            this.timers.length = 0; //clear the timer array

            // Start new timers
            this.startChlorineTimers();
            this.startFilterTimers();
            this.startHeaterTimers();
        }

        // Starts the chlorine timers, and toggles the pump accordingly
        private startChlorineTimers() {
            // Start timers for each timeframe and adds them to the timer list
            for (const [start, dose_ml] of poolData.getChlorineTimings().entries()) {
                // Turn chlorine on
                this.timers.push(setTimeout(() => {
                    if (!poolData.chlorineScheduled) return;
                    this.chlorinePumpOn = true
                }, start.fromNow().minutes * 60 * 1000)); // Start time in ms

                // Turn chlorine off if it currently isn't quickdosing
                var stopTime = start.add(Data.doseToTime(dose_ml));
                this.timers.push(setTimeout(() => {
                    if (!poolData.chlorineScheduled) return;
                    if (this.quickDoseTimer === null)
                        this.chlorinePumpOn = false
                }, stopTime.fromNow().minutes * 60 * 1000)); // Stop time in ms
            }

            // adjust state for current time
            if (!poolData.chlorineScheduled) return;
            if (poolData.isChlorineScheduled(Data.Time.now())) {
                this.chlorinePumpOn = true
            } else {
                if (this.quickDoseTimer === null)
                    this.chlorinePumpOn = false
            }
        }

        // Starts the filter timers, and toggles the filter accordingly
        private startFilterTimers() {
            // Start timers for each timeframe and adds them to the timer list
            for (const [start, stop] of poolData.getFilterTimings().entries()) {
                // Turn filter on
                this.timers.push(setTimeout(() => {
                    if (!poolData.filterScheduled) return;
                    this.filterOn = true;
                }, start.fromNow().minutes * 60 * 1000)); // Start time in ms

                // Turn filter off if the heater isn't on
                this.timers.push(setTimeout(() => {
                    if (!poolData.filterScheduled) return;
                    if (!this.heaterOn) this.filterOn = false;
                }, stop.fromNow().minutes * 60 * 1000)); // Stop time in ms
            }

            // adjust state for current time
            if (!poolData.filterScheduled) return;
            if (poolData.isFilterScheduled(Data.Time.now())) {
                this.filterOn = true;
            } else {
                if (!this.heaterOn) this.filterOn = false;
            }
        }

        // Starts the filter timers, and toggles the heater accordingly
        private startHeaterTimers() {
            // Start timers for each timeframe and adds them to the timer list
            for (const [start, stop] of poolData.getHeaterTimings().entries()) {
                // Turn filter and heater on
                this.timers.push(setTimeout(() => {
                    if (!poolData.heaterScheduled) return;
                    this.filterOn = true;
                    this.heaterOn = true;
                }, start.fromNow().minutes * 60 * 1000)); // Start time in ms

                // Turn heater off and filter too its scheduled state
                this.timers.push(setTimeout(() => {
                    if (!poolData.heaterScheduled) return;
                    this.heaterOn = false;
                    this.filterOn = poolData.isFilterScheduled(stop);
                }, stop.fromNow().minutes * 60 * 1000)); // Stop time in ms
            }

            // adjust state for current time
            if (!poolData.heaterScheduled) return;
            if (poolData.isHeaterScheduled(Data.Time.now())) {
                this.filterOn = true;
                this.heaterOn = true;
            } else {
                this.heaterOn = false;
            }
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
}
