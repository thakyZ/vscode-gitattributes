import * as path from 'path';
import * as Mocha from 'mocha';
import { glob } from 'glob';

export function run(): Promise<void> {
	// Create the mocha test
	const mocha = new Mocha({
		ui: 'tdd'
	});

	const testsRoot = path.resolve(__dirname, '..');

	return new Promise((c, e) => {
		(async function() {
			const files: unknown | string[] = await glob('**/**.test.js', { cwd: testsRoot });

			if (Array.isArray(files)) {
				// Add files to the test suite
				files.forEach(f => mocha.addFile(path.resolve(testsRoot, f)));

				try {
					// Run the mocha test
					mocha.run(failures => {
						if (failures > 0) {
							e(new Error(`${failures} tests failed.`));
						} else {
							c();
						}
					});
				} catch (err) {
					console.error(err);
					e(err);
				}
			} else {
				return e(files);
			}
		})();
	});
}