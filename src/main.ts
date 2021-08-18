import { Data } from './data';
import { WebServer } from './WebServer';
import { WebSocketServer } from './WebSocketServer';
import { Hardware } from "./hardware";

//Data structures
export var pinConfig: Data.PinConfig = Data.load(new Data.PinConfig());
export var poolData: Data.PoolData = Data.PoolData.load();
poolData.addFilterTiming(new Data.Time("22:00"), new Data.Time("05:00"))
export var hotTubData: Data.HotTubData = Data.load(new Data.HotTubData());

//Servers
export var webSocketServer: WebSocketServer = new WebSocketServer();
export var webServer: WebServer = new WebServer();

//Hardware controllers
export var poolController: Hardware.PoolController = new Hardware.PoolController();
export var hotTubController: Hardware.HotTubController = new Hardware.HotTubController();
export var heatPumpController: Hardware.HeatPumpController = new Hardware.HeatPumpController();

webSocketServer.start();
