// The test doubles must honour the same driven-port contracts as the real adapters.
import { FixedClock } from './fixed-clock.js';
import { SequenceIdGenerator } from './sequence-id-generator.js';
import { describeClockContract } from '../contracts/clock.contract.js';
import { describeIdGeneratorContract } from '../contracts/id-generator.contract.js';
import { StubRenderer } from './stub-renderer.js';
import { describeSymbolRendererContract } from '../contracts/symbol-renderer.contract.js';

describeClockContract('FixedClock', () => new FixedClock());
describeIdGeneratorContract('SequenceIdGenerator', () => new SequenceIdGenerator());
describeSymbolRendererContract('StubRenderer', () => new StubRenderer({ invalid: ['10031000009999990000'] }), {
  validSidc: '10031000001211000000',
  invalidSidc: '10031000009999990000',
});
