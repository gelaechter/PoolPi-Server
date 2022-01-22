import * as Data from "./data";
import { WebSocketServer } from "./WebSocketServer";
import * as Hardware from "./hardware";

// Data structures
export const configData: Data.ConfigData = Data.ConfigData.load();
export let poolData: Data.PoolData = Data.PoolData.load();

// Websockett Server
export const webSocketServer: WebSocketServer = new WebSocketServer();

// Hardware controllers
export const poolController: Hardware.PoolController = new Hardware.PoolController();
export const heatPumpController: Hardware.HeatPumpController = new Hardware.HeatPumpController();

webSocketServer.start();
