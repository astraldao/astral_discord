// Preload for `npm run test:clock`: runs the suite as if started at ASTRAL_TEST_CLOCK,
// so tests that silently depend on today's month or year fail before the calendar reaches them.
const start=Date.parse(process.env.ASTRAL_TEST_CLOCK??'');
if(Number.isFinite(start)){
  const Real=Date,shift=start-Real.now();
  globalThis.Date=class extends Real{constructor(...args){if(args.length)super(...args);else super(Real.now()+shift);}static now(){return Real.now()+shift;}};
}
