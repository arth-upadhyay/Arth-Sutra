// Back-compat re-export so existing imports of
// `import GSTReturns from '../components/GstReturns'` keep working after the
// single-file was refactored into this folder.
export { default } from './GstReturns';
export { default as GSTReturns } from './GstReturns';