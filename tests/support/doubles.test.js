// The test doubles must honour the same driven-port contracts as the real adapters.
import { FixedClock } from './fixed-clock.js';
import { SequenceIdGenerator } from './sequence-id-generator.js';
import { describeClockContract } from '../contracts/clock.contract.js';
import { describeIdGeneratorContract } from '../contracts/id-generator.contract.js';

describeClockContract('FixedClock', () => new FixedClock());
describeIdGeneratorContract('SequenceIdGenerator', () => new SequenceIdGenerator());
