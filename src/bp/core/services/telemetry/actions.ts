import { parseActionInstruction } from 'common/action'
import { BUILTIN_MODULES } from 'common/defaults'
import LicensingService from 'common/licensing-service'
import { getSchema } from 'common/telemetry'
import Database from 'core/database'
import { calculateHash } from 'core/misc/utils'
import { TelemetryRepository } from 'core/repositories/telemetry_payload'
import { TYPES } from 'core/types'
import { inject, injectable } from 'inversify'
import ms from 'ms'
import path from 'path'

import { GhostService } from '..'
import { JobService } from '../job-service'

import { TelemetryStats } from './telemetry-stats'
import { FlowService } from '../dialog/flow/service'
import { BotService } from '../bot-service'
import { async } from 'q'
import _ from 'lodash'
import { ActionBuilderProps } from 'botpress/sdk'

interface NextNode {
  condition: string
  node: string
}

interface Node {
  id: string
  name: string
  next: NextNode[]
  onEnter: string[]
  onReceive: string[]
  type: string
}

interface Flow {
  flowName: string
  botID: string
  actions: string[]
}

@injectable()
export class ActionsStats extends TelemetryStats {
  protected url: string
  protected lock: string
  protected interval: number

  constructor(
    @inject(TYPES.GhostService) ghostService: GhostService,
    @inject(TYPES.Database) database: Database,
    @inject(TYPES.LicensingService) licenseService: LicensingService,
    @inject(TYPES.JobService) jobService: JobService,
    @inject(TYPES.TelemetryRepository) telemetryRepo: TelemetryRepository,
    @inject(TYPES.FlowService) private flowService: FlowService,
    @inject(TYPES.BotService) private botService: BotService
  ) {
    super(ghostService, database, licenseService, jobService, telemetryRepo)
    this.url = process.TELEMETRY_URL
    this.lock = 'botpress:telemetry-actions'
    this.interval = ms('1d')
  }

  protected async getStats() {
    return {
      ...getSchema(await this.getServerStats(), 'server'),
      event_type: 'builtin_actions',
      event_data: { schema: '1.0.0', flows: await this.getFlowsWithActions() }
    }
  }

  private async getFlowsWithActions() {
    const botIds = await this.botService.getBotsIds()
    const flows = _.flatten(
      await Promise.map(botIds, async botID => {
        const flowView = await this.flowService.loadAll(botID)
        return flowView.map(flow => {
          const { name } = flow
          const actions = flow.nodes
            .map(node => [...((node.onEnter as string[]) ?? []), ...((node.onReceive as string[]) ?? [])])
            .reduce((acc, cur) => [...acc, ...cur])

          return { flowName: name, botID, actions }
        })
      })
    )
    console.log(JSON.stringify(flows.filter(flow => flow.actions.length > 0).map(flow => this.parseFlow(flow))))
    return flows.filter(flow => flow.actions.length > 0).map(flow => this.parseFlow(flow))
  }

  private parseFlow(flow: Flow) {
    const actions = flow.actions
      .map(action => parseActionInstruction(action))
      .filter(action => BUILTIN_MODULES.includes(action.actionName.split('/')[0]))

    return {
      actions: actions.map(action => {
        const actionName = action.actionName.split('/')[1]
        try {
          const params = JSON.parse(action.argsStr)
          for (const key in params) {
            params[key] = !!params[key] ? 1 : 0
          }
          return { actionName, params }
        } catch (error) {
          return { actionName, params: {} }
        }
      }),
      flowName: calculateHash(flow.flowName),
      botID: calculateHash(flow.botID)
    }
  }
}
