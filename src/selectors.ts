import type {
  Init,
  ProducerOperation,
  Proposal,
  Round,
  State,
  Task,
  Wave,
} from "./core.js";
import { assertDomain, ERROR_CODES } from "./errors.js";

export function roundsFor(
  state: State,
  operation: ProducerOperation,
  subjectId: string,
): Round[] {
  if (operation === "spec") return getInit(state, subjectId).specRounds;
  const wave = getWave(state, subjectId);
  return operation === "plan" ? wave.planRounds : wave.buildRounds;
}

export function getOpenRound(
  rounds: Round[],
  operation: string,
  subjectId: string,
): Round {
  const round = [...rounds].reverse().find((candidate) => candidate.status === "open");
  assertDomain(
    round,
    ERROR_CODES.NO_OPEN_ROUND,
    `${subjectId} has no open ${operation} round`,
  );
  return round;
}

export function getRound(rounds: Round[], number: number): Round {
  const round = rounds.find((candidate) => candidate.number === number);
  assertDomain(round, ERROR_CODES.ROUND_NOT_FOUND, `round ${number} does not exist`);
  return round;
}

export function getInit(state: State, initId: string): Init {
  const init = state.inits.find((candidate) => candidate.id === initId);
  assertDomain(init, ERROR_CODES.INIT_NOT_FOUND, `${initId} does not exist`);
  return init;
}

export function getWave(state: State, waveId: string): Wave {
  const wave = state.waves.find((candidate) => candidate.id === waveId);
  assertDomain(wave, ERROR_CODES.WAVE_NOT_FOUND, `${waveId} does not exist`);
  return wave;
}

export function getWork(state: State, workId: string) {
  const work = state.works.find((candidate) => candidate.id === workId);
  assertDomain(work, ERROR_CODES.WORK_NOT_FOUND, `${workId} does not exist`);
  return work;
}

export function getTask(state: State, taskId: string): Task {
  const task = state.tasks.find((candidate) => candidate.id === taskId);
  assertDomain(task, ERROR_CODES.TASK_NOT_FOUND, `${taskId} does not exist`);
  return task;
}

export function getProposal(state: State, proposalId: string): Proposal {
  const proposal = state.proposals.find((candidate) => candidate.id === proposalId);
  assertDomain(
    proposal,
    ERROR_CODES.PROPOSAL_NOT_FOUND,
    `${proposalId} does not exist`,
  );
  return proposal;
}
