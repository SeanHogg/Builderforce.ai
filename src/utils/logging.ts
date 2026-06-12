import { type BrowserConsole } from "@builderforce/browser-console"; // Assuming this exists for browser environments

export class Logger {
	private readonly namespace: string;
	private readonly console: BrowserConsole | Console;

	constructor(namespace: string, consoleInstance: Console | BrowserConsole = console) {
		this.namespace = namespace;
		this.console = consoleInstance;
	}

	/**
	 * Creates a child logger with a nested namespace.
	 * @param namespace - The namespace for the child logger.
	 * @returns A new Logger instance.
	 */
	public child(namespace: string): Logger {
		return new Logger(`${this.namespace}:${namespace}`, this.console);
	}

	/**
	 * Logs a debug message.
	 * @param message - The message to log.
	 * @param optionalParams - Optional parameters to include in the log.
	 */
	public debug(message: string, ...optionalParams: any[]): void {
		this.log("debug", message, ...optionalParams);
	}

	/**
	 * Logs an info message.
	 * @param message - The message to log.
	 * @param optionalParams - Optional parameters to include in the log.
	 */
	public info(message: string, ...optionalParams: any[]): void {
		this.log("info", message, ...optionalParams);
	}

	/**
	 * Logs a warning message.
	 * @param message - The message to log.
	 * @param optionalParams - Optional parameters to include in the log.
	 */
	public warn(message: string, ...optionalParams: any[]): void {
		this.log("warn", message, ...optionalParams);
	}

	/**
	 * Logs an error message.
	 * @param message - The message to log.
	 * @param optionalParams - Optional parameters to include in the log.
	 */
	public error(message: string, ...optionalParams: any[]): void {
		this.log("error", message, ...optionalParams);
	}

	/**
	 * Logs a message using the appropriate console method based on the log level.
	 * @param level - The log level ("debug", "info", "warn", "error").
	 * @param message - The message to log.
	 * @param optionalParams - Optional parameters to include in the log.
	 */
	private log(level: "debug" | "info" | "warn" | "error", message: string, ...optionalParams: any[]): void {
		const logMessage = `[${this.namespace}] ${message}`;
		switch (level) {
			case "debug":
				this.console.debug?.(logMessage, ...optionalParams); // Use optional ?. for safety
				break;
			case "info":
				this.console.info(logMessage, ...optionalParams);
				break;
			case "warn":
				this.console.warn(logMessage, ...optionalParams);
				break;
			case "error":
				this.console.error(logMessage, ...optionalParams);
				break;
			default:
				this.console.log(logMessage, ...optionalParams); // Fallback to general log
		}
	}
}
