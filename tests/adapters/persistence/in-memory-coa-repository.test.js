import { InMemoryCoaRepository } from '../../../src/adapters/persistence/in-memory-coa-repository.js';
import { describeCoaRepositoryContract } from '../../contracts/coa-repository.contract.js';

describeCoaRepositoryContract('InMemoryCoaRepository', () => new InMemoryCoaRepository());
