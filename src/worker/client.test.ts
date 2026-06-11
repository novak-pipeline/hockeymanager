import { afterEach, describe, expect, it, vi } from 'vitest'
import { SimClient, type WorkerLike } from './client'
import type { TeamTactics } from '@domain'
import type { CareerSnapshot, WorkerRequest, WorkerResponse } from './protocol'

class FakeWorker implements WorkerLike {
  onmessage: ((ev: MessageEvent<WorkerResponse>) => void) | null = null
  readonly sent: WorkerRequest[] = []
  terminated = false

  postMessage(message: unknown): void {
    this.sent.push(message as WorkerRequest)
  }

  terminate(): void {
    this.terminated = true
  }

  reply(res: WorkerResponse): void {
    this.onmessage?.({ data: res } as MessageEvent<WorkerResponse>)
  }
}

function make(): { client: SimClient; worker: FakeWorker } {
  const worker = new FakeWorker()
  return { client: new SimClient(worker), worker }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('SimClient', () => {
  it('resolves a response matched by request id', async () => {
    const { client, worker } = make()
    const promise = client.ping()
    const sent = worker.sent[0]!
    expect(sent.type).toBe('ping')
    worker.reply({ id: sent.id, type: 'pong', at: 1 })
    const res = await promise
    expect(res).toEqual({ id: sent.id, type: 'pong', at: 1 })
  })

  it('correlates concurrent requests answered out of order', async () => {
    const { client, worker } = make()
    const first = client.getSquad()
    const second = client.getInbox()
    const [reqA, reqB] = [worker.sent[0]!, worker.sent[1]!]
    expect(reqA.id).not.toBe(reqB.id)
    worker.reply({ id: reqB.id, type: 'error', message: 'not implemented' })
    worker.reply({ id: reqA.id, type: 'error', message: 'no squad' })
    await expect(first).resolves.toMatchObject({ id: reqA.id, message: 'no squad' })
    await expect(second).resolves.toMatchObject({ id: reqB.id, message: 'not implemented' })
  })

  it('resolves a timeout error after 20s of silence', async () => {
    vi.useFakeTimers()
    const { client } = make()
    const promise = client.getDashboard()
    vi.advanceTimersByTime(19_999)
    vi.advanceTimersByTime(1)
    const res = await promise
    expect(res).toMatchObject({ type: 'error', message: 'timeout' })
  })

  it('ignores a late response arriving after the timeout', async () => {
    vi.useFakeTimers()
    const { client, worker } = make()
    const promise = client.getDashboard()
    const id = worker.sent[0]!.id
    vi.advanceTimersByTime(20_000)
    const res = await promise
    expect(res.type).toBe('error')
    // Late + malformed messages must not throw or re-resolve anything.
    expect(() => {
      worker.reply({
        id,
        type: 'dashboard',
        dashboard: {} as never,
      })
      worker.onmessage?.({ data: undefined } as unknown as MessageEvent<WorkerResponse>)
    }).not.toThrow()
  })

  it('omits optional request fields instead of sending undefined', () => {
    const { client, worker } = make()
    void client.newLeague(7)
    void client.advance()
    expect('teamCount' in worker.sent[0]!).toBe(false)
    expect('days' in worker.sent[1]!).toBe(false)
    void client.newLeague(7, 12)
    void client.advance(3)
    expect(worker.sent[2]).toMatchObject({ type: 'newLeague', seed: 7, teamCount: 12 })
    expect(worker.sent[3]).toMatchObject({ type: 'advance', days: 3 })
  })

  it('maps every method to its protocol message', () => {
    const { client, worker } = make()
    const lines = {
      forwards: [],
      defensePairs: [],
      goalies: [],
      powerPlayUnits: [],
      penaltyKillUnits: [],
    }
    const proposal = {
      partnerTeamId: 't2',
      givePlayerIds: [],
      givePickIds: [],
      receivePlayerIds: [],
      receivePickIds: [],
    }
    const calls: Array<[() => Promise<WorkerResponse>, Record<string, unknown>]> = [
      [() => client.ping(), { type: 'ping' }],
      [() => client.version(), { type: 'version' }],
      [() => client.startCareer('t1'), { type: 'startCareer', teamId: 't1' }],
      [() => client.advanceToNextGame(), { type: 'advanceToNextGame' }],
      [() => client.continueGame(), { type: 'continue' }],
      [() => client.watch(), { type: 'watch' }],
      [() => client.getDashboard(), { type: 'getDashboard' }],
      [() => client.getSquad(), { type: 'getSquad' }],
      [() => client.getPlayer('p9'), { type: 'getPlayer', playerId: 'p9' }],
      [() => client.getTactics(), { type: 'getTactics' }],
      [() => client.getSchedule(), { type: 'getSchedule' }],
      [() => client.getStandings(), { type: 'getStandings' }],
      [() => client.getStats(), { type: 'getStats' }],
      [() => client.getTrades(), { type: 'getTrades' }],
      [() => client.getDraft(), { type: 'getDraft' }],
      [() => client.getFinances(), { type: 'getFinances' }],
      [() => client.getInbox(), { type: 'getInbox' }],
      [() => client.getPlayoffs(), { type: 'getPlayoffs' }],
      [() => client.getOffseason(), { type: 'getOffseason' }],
      [() => client.getLastBoxScore(), { type: 'getLastBoxScore' }],
      [() => client.setLines(lines), { type: 'setLines', lines }],
      [() => client.setTactics({} as TeamTactics), { type: 'setTactics' }],
      [() => client.markNewsRead(['n1', 'n2']), { type: 'markNewsRead', ids: ['n1', 'n2'] }],
      [() => client.proposeTrade(proposal), { type: 'proposeTrade', proposal }],
      [() => client.acceptTrade('o1'), { type: 'acceptTrade', offerId: 'o1' }],
      [() => client.rejectTrade('o2'), { type: 'rejectTrade', offerId: 'o2' }],
      [
        () => client.resignPlayer('p1', 3_500_000, 4),
        { type: 'resignPlayer', playerId: 'p1', salary: 3_500_000, years: 4 },
      ],
      [() => client.releasePlayer('p2'), { type: 'releasePlayer', playerId: 'p2' }],
      [
        () => client.signFreeAgent('p3', 900_000, 1),
        { type: 'signFreeAgent', playerId: 'p3', salary: 900_000, years: 1 },
      ],
      [() => client.draftPlayer('p4'), { type: 'draftPlayer', playerId: 'p4' }],
      [() => client.advanceDraft(), { type: 'advanceDraft' }],
      [() => client.advanceOffseason(), { type: 'advanceOffseason' }],
      [() => client.exportSave('My save'), { type: 'exportSave', saveName: 'My save' }],
      [() => client.importSave({} as CareerSnapshot), { type: 'importSave' }],
    ]
    for (const [invoke, expected] of calls) void invoke()
    expect(worker.sent).toHaveLength(calls.length)
    calls.forEach(([, expected], i) => {
      expect(worker.sent[i]).toMatchObject(expected)
      expect(typeof worker.sent[i]!.id).toBe('number')
    })
  })

  it('dispose terminates the worker and resolves in-flight requests', async () => {
    const { client, worker } = make()
    const inFlight = client.getStats()
    client.dispose()
    expect(worker.terminated).toBe(true)
    await expect(inFlight).resolves.toMatchObject({ type: 'error', message: 'disposed' })
  })
})
