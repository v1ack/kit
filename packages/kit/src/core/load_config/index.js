import options from './options.js';
import * as url from 'url';
import path from 'path';
import fs from 'fs';

/** @typedef {import('./types').ConfigDefinition} ConfigDefinition */

/**
 * @param {Record<string, ConfigDefinition>} definition
 * @param {any} option
 * @param {string} keypath
 * @returns {any}
 */
function validate(definition, option, keypath) {
	for (const key in option) {
		if (!(key in definition)) {
			let message = `Unexpected option ${keypath}.${key}`;

			if (keypath === 'config' && key in options.kit) {
				message += ` (did you mean config.kit.${key}?)`;
			} else if (keypath === 'config.kit' && key in options) {
				message += ` (did you mean config.${key}?)`;
			}

			throw new Error(message);
		}
	}

	/** @type {Record<string, any>} */
	const merged = {};

	for (const key in definition) {
		const expected = definition[key];
		const actual = option[key];

		const child_keypath = `${keypath}.${key}`;

		if (key in option) {
			if (expected.type === 'branch') {
				if (actual && (typeof actual !== 'object' || Array.isArray(actual))) {
					throw new Error(`${keypath}.${key} should be an object`);
				}

				merged[key] = validate(expected.children, actual, child_keypath);
			} else {
				merged[key] = expected.validate(actual, child_keypath);
			}
		} else {
			merged[key] =
				expected.type === 'branch'
					? validate(expected.children, {}, child_keypath)
					: expected.default;
		}
	}

	return merged;
}

/**
 * @param {string} from
 * @param {string} to
 */
function resolve(from, to) {
	// the `/.` is weird, but allows `${assets}/images/blah.jpg` to work
	// when `assets` is empty
	return remove_trailing_slash(url.resolve(add_trailing_slash(from), to)) || '/.';
}

/**
 * @param {string} str
 */
function add_trailing_slash(str) {
	return str.endsWith('/') ? str : `${str}/`;
}

/**
 * @param {string} str
 */
function remove_trailing_slash(str) {
	return str.endsWith('/') ? str.slice(0, -1) : str;
}

/**
 * @param {string} cwd
 * @param {import('types/config').ValidatedConfig} validated
 */
function validate_template(cwd, validated) {
	const { template } = validated.kit.files;
	const relative = path.relative(cwd, template);

	if (fs.existsSync(template)) {
		const contents = fs.readFileSync(template, 'utf8');
		const expected_tags = ['%svelte.head%', '%svelte.body%'];
		expected_tags.forEach((tag) => {
			if (contents.indexOf(tag) === -1) {
				throw new Error(`${relative} is missing ${tag}`);
			}
		});
	} else {
		throw new Error(`${relative} does not exist`);
	}
}

export async function load_config({ cwd = process.cwd() } = {}) {
	const config_file_esm = path.join(cwd, 'svelte.config.js');
	const config_file = fs.existsSync(config_file_esm)
		? config_file_esm
		: path.join(cwd, 'svelte.config.cjs');
	const config = await import(url.pathToFileURL(config_file).href);
	const validated = validate_config(config.default);

	validated.kit.files.assets = path.resolve(cwd, validated.kit.files.assets);
	validated.kit.files.hooks = path.resolve(cwd, validated.kit.files.hooks);
	validated.kit.files.lib = path.resolve(cwd, validated.kit.files.lib);
	validated.kit.files.routes = path.resolve(cwd, validated.kit.files.routes);
	validated.kit.files.serviceWorker = path.resolve(cwd, validated.kit.files.serviceWorker);
	validated.kit.files.setup = path.resolve(cwd, validated.kit.files.setup);
	validated.kit.files.template = path.resolve(cwd, validated.kit.files.template);

	validate_template(cwd, validated);

	// TODO check all the `files` exist when the config is loaded?

	return validated;
}

/**
 * @param {import('types/config').Config} config
 * @returns {import('types/config').ValidatedConfig}
 */
export function validate_config(config) {
	/** @type {import('types/config').ValidatedConfig} */
	const validated = validate(options, config, 'config');

	// resolve paths
	const { paths } = validated.kit;

	if (paths.base !== '' && (paths.base.endsWith('/') || !paths.base.startsWith('/'))) {
		throw new Error(
			"kit.paths.base option must be a root-relative path that starts but doesn't end with '/'. See https://kit.svelte.dev/docs#configuration-paths"
		);
	}

	paths.assets = resolve(paths.base, paths.assets);

	return validated;
}
