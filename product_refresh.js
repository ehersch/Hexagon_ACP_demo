// This file is currently not running with the setup
// This can be invoked from server.js to only fetch Hexagon Shopify data

import cron from 'node-cron';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fetchScript = path.join(__dirname, 'get_shopify_info.js');

export function startProductRefreshCron() {
	const runSync = () => {
		console.log(`[${new Date().toISOString()}] Refreshing Shopify products...`);
		const child = spawn(process.execPath, [fetchScript], {
			stdio: 'inherit'
		});

		child.on('exit', (code) => {
			if (code === 0) {
				console.log(`Product refresh completed at ${new Date().toISOString()}.`);
			} else {
				console.error(`Product refresh failed with code ${code}.`);
			}
		});
	};

	// Run immediately on startup to keep cache fresh.
	runSync();

	// Schedule refresh every 15 minutes.
	cron.schedule('* * * * *', runSync);
}
