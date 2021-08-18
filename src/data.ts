import { writeFileSync, readFileSync, existsSync } from 'fs';

export namespace Data {
    // Dosage pump dosing speed
    const litres_per_hour: number = 0.96;

    // Class modeling a time passed since 00:00
    export class Time {
        //This should be in minutes since 00:00
        private time: number = 0;

        // new Time based on either minutes, text or a Date
        constructor(time: any) {
            if (typeof (time) === "number") { this.minutes = time; }
            else if (typeof (time) === "string") { this.text = time; }
            else if (time.constructor.name === "Date") {
                this.text =
                    (time as Date).getHours() + ":" + (time as Date).getMinutes();
            }
        }

        public get minutes() {
            return this.time;
        }

        public get text() {
            var hours = Math.floor(this.minutes / 60);
            var minutes = this.minutes % 60;
            return String(hours).padStart(2, "0") + ':' + String(minutes).padStart(2, "0")
        }

        public set minutes(minutes: number) {
            if (minutes < 0 || minutes > 1440) {
                throw new Error('Invalid amount of minutes');
            }
            this.time = minutes;
        }

        public set text(time: string) {
            var hours: number = parseInt(time.split(':')[0]);
            var minutes: number = parseInt(time.split(':')[1]);

            this.time = minutes + hours * 60;
        }

        // adds this Time to another
        public add(time: Time): Time {
            var time: Time = new Time(this.minutes + time.minutes);
            if (time.minutes > 1440) time = new Time(time.minutes - 1440);
            return time;
        }

        public subtract(time: Time): Time {
            var minutes: number = this.minutes - time.minutes;
            if (minutes < 0) minutes = 1440 - time.minutes;
            return new Time(minutes);
        }

        public fromNow(): Time {
            return this.subtract(Time.now())
        }

        public static now(): Time {
            return new Time(new Date());
        }
    }

    // class to configure the pins for the different IOs
    export class PinConfig {
        // pool
        public pool_chlorinePump: number = 10;
        public pool_filter: number = 8;
        public pool_heater: number = 12;

        // hot tub
        public hottub_heater: number = 16;
        public hottub_pump: number = 18;
        public hottub_filterPump: number = 22;
        public hottub_UVLamp: number = 24;
        public hottub_chlorinePump: number = 26;
        // public hottub_LED: number = 0;

        public tempSensors: number = 7;
    }

    // Data that will be saved upon change
    export class PoolData {
        // Scheduler toggles
        public chlorineScheduled: boolean = true;
        public heaterScheduled: boolean = true;
        public filterScheduled: boolean = true;

        // Timing Maps consisting of the start time and the stop time
        private _chlorineTimings: Map<Time, number> = new Map(); // Start time and dose; dose here measured in millilitres
        private _heaterTimings: Map<Time, Time> = new Map();
        private _filterTimings: Map<Time, Time> = new Map();
        public doses: number[] = [0, 0, 0];

        public getChlorineTimings(): Map<Time, number> {
            return this._chlorineTimings;
        }

        public getHeaterTimings(): Map<Time, Time> {
            return this._heaterTimings;
        }

        public getFilterTimings(): Map<Time, Time> {
            return this._filterTimings;
        }

        // adds start and stop to a map if they are outside all other ranges
        private addTiming(start: Time, stop: Time, map: Map<Time, Time>) {
            if (map.has(start)) return; // If a timing starting with this already exists deny
            if (map.size < 1) {
                // If empty just add it
                map.set(start, stop);
            } else {
                // Else check if the new time frame is outside of other timeframes
                if (this.isScheduled(start, map)) return;
                if (this.isScheduled(stop, map)) return;
                map.set(start, stop);
            }
        }

        // Practically the same as addTiming() but converts dosis_ml to a Time
        public addChlorineTiming(start: Time, dosis_ml: number) {
            if (this._chlorineTimings.has(start)) return; // If a timing starting with this already exists deny
            if (this._chlorineTimings.size < 1) {
                // If empty just add it
                this._chlorineTimings.set(start, dosis_ml);
            } else {
                // Else check if it is outside of other time frames; Stop time has to be calculated to check against
                if (this.isChlorineScheduled(start)) return;
                if (this.isChlorineScheduled(start.add(doseToTime(dosis_ml)))) return;
                this._chlorineTimings.set(start, dosis_ml);
            }
        }

        public addHeaterTiming(start: Time, stop: Time) {
            this.addTiming(start, stop, this._heaterTimings);
        }

        public addFilterTiming(start: Time, stop: Time) {
            this.addTiming(start, stop, this._filterTimings);
        }

        public removeChlorineTiming(start: Time) {
            this._chlorineTimings.delete(start);
        }

        public removeHeaterTiming(start: Time) {
            this._heaterTimings.delete(start);
        }

        public removeFilterTiming(start: Time) {
            this._filterTimings.delete(start);
        }

        /**
         * Function to check if a point in time is scheduled by a timing Map.
         * Basically checks all timeframes of a map if they include the time.
         *
         * @param  {Time} time The time to check
         * @param  {Map<Time, Time>} timings The timing map to check against
         * @return {boolean} True if time is contained in a timing map, false if not
         */
        private isScheduled(time: Time, timings: Map<Time, Time>) {
            for (const [startTime, stopTime] of timings.entries()) {
                if (isInTimeframe(time, startTime, stopTime)) return true;
            }
            return false;
        }

        public isChlorineScheduled(time: Time): boolean {
            for (const [startTime, dosis] of this._chlorineTimings.entries()) {
                // stop Time calculated from dosis using helper function
                var stopTime: Time = startTime.add(doseToTime(dosis));
                if (isInTimeframe(time, startTime, stopTime)) return true;
            }
            return false;
        }

        public isHeaterScheduled(time: Time): boolean {
            return this.isScheduled(time, this._heaterTimings);

        }

        public isFilterScheduled(time: Time): boolean {
            return this.isScheduled(time, this._filterTimings);
        }

        public save() {
            return JSON.stringify(this, replacer);
        }

        public static load(): PoolData {
            if (existsSync(this.constructor.name + '.json')) {
                var data = readFileSync(this.constructor.name + '.json');
                return Object.assign(new PoolData(), JSON.parse(data.toString(), reviver));
            }
            return new PoolData;
        }
    }

    export class HotTubData { }


    /**
     * Function to check if a Time is within a timeframe, hence inbetween start and stop
     *
     * @param  {Time} time The time to check
     * @param  {Time} start The start Time of the timeframe to check against
     * @param  {Time} stop The stop Time of the timeframe to check against
     * @returns {boolean} True if time is within the timeframe, false if not
     */
    export function isInTimeframe(time: Time, start: Time, stop: Time): boolean {
        //Check if the timeframe is simple or loops around a day
        if (stop.minutes < start.minutes) {
            //check if the point in time happens after start or before stop
            return (time.minutes > start.minutes || time.minutes < stop.minutes);
        } else {
            //Check if the point in time is inbetween
            return (time.minutes >= start.minutes && time.minutes <= stop.minutes);
        }
    }

    /**
     * Function to convert a ml dose into a Time
     * Add this to the start time to receive the stop time
     * @param  {any} object - Any of the Data classes.
     */
    export function doseToTime(dosis_ml: number): Time {
        var ml_per_hour = litres_per_hour * 1000;
        var ml_per_minute = ml_per_hour / 60; // At the rate of 0.96 L/h this should be 16 mL/min
        var minutes = dosis_ml / ml_per_minute;

        if (minutes > 1440)
            return new Time(1440)
        return new Time(minutes);
    }

    export function toJSON(object: any): string {
        return JSON.stringify(object, replacer);
    }

    export function fromJSON(json: string): any {
        var object: any = new Object();
        return Object.assign(object, JSON.parse(json, reviver));
    }

    /**
     * Function to save any of the Data classes to a json file
     * @param  {any} object - Any of the Data classes.
     */
    export function save(object: any) {
        writeFileSync(object.constructor.name + '.json', toJSON(object));
    }

    /**
     * Function to load one of the above data classes.
     * @param {any} object - Any of the Data classes.
     * @returns {any} - Will return the loaded object
     */
    export function load(object: any): any {
        if (existsSync(object.constructor.name + '.json')) {
            var data = readFileSync(object.constructor.name + '.json');
            object = fromJSON(data.toString());
        }
        return object;
    }

    //function for map serialization to JSON
    function replacer(key, value) {
        if (value instanceof Map) {
            return {
                dataType: 'Map',
                value: Array.from(value.entries()), // or with spread: value: [...value]
            };
        } else if (value instanceof Time) {
            return {
                dataType: 'Time',
                minutes: value.minutes,
            };
        } else {
            return value;
        }
    }

    //function for map serialization from JSON
    function reviver(key, value) {
        if (typeof value === 'object' && value !== null) {
            if (value.dataType === 'Map') {
                return new Map(value.value);
            } else if (value.dataType === 'Time') {
                return new Time(value.minutes);
            }
        }
        return value;
    }
}
