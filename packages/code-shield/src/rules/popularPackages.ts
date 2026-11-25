/**
 * Curated popular npm package names a typosquat would imitate. Not exhaustive: a name one edit away from
 * one of these (and not equal to it) is flagged for review, nothing more.
 */
export const POPULAR_PACKAGES: readonly string[] = [
  'react', 'react-dom', 'react-router', 'react-router-dom', 'redux', 'react-redux', 'next', 'vue', 'vuex', 'nuxt',
  'angular', 'svelte', 'express', 'koa', 'fastify', 'hapi', 'lodash', 'underscore', 'moment', 'dayjs',
  'axios', 'request', 'node-fetch', 'superagent', 'got', 'chalk', 'commander', 'yargs', 'inquirer', 'debug',
  'async', 'bluebird', 'rxjs', 'uuid', 'nanoid', 'mkdirp', 'rimraf', 'glob', 'minimist', 'semver',
  'webpack', 'rollup', 'vite', 'esbuild', 'babel', 'typescript', 'eslint', 'prettier', 'jest', 'mocha',
  'chai', 'sinon', 'vitest', 'cypress', 'puppeteer', 'playwright', 'jquery', 'bootstrap', 'tailwindcss', 'sass',
  'less', 'postcss', 'autoprefixer', 'dotenv', 'cors', 'body-parser', 'cookie-parser', 'morgan', 'helmet', 'passport',
  'jsonwebtoken', 'bcrypt', 'bcryptjs', 'mongoose', 'mongodb', 'mysql', 'mysql2', 'pg', 'redis', 'ioredis',
  'sequelize', 'typeorm', 'prisma', 'knex', 'socket.io', 'ws', 'zod', 'joi', 'yup', 'ajv',
  'cheerio', 'fs-extra', 'graceful-fs', 'colors', 'ora', 'execa', 'cross-env', 'nodemon', 'ts-node', 'tslib',
  'core-js', 'regenerator-runtime', 'classnames', 'prop-types', 'immutable', 'ramda', 'date-fns', 'validator', 'qs', 'ms',
];
