import {
  Button,
  ButtonGroup,
  HTMLSelect,
  IconName,
  MaybeElement,
  Popover,
  Position,
  Tooltip as BpTooltip
} from '@blueprintjs/core'
import { DateRange, DateRangePicker, IDateRangeShortcut } from '@blueprintjs/datetime'
import '@blueprintjs/datetime/lib/css/blueprint-datetime.css'
import axios from 'axios'
import { lang } from 'botpress/shared'
import cx from 'classnames'
import _ from 'lodash'
import moment from 'moment'
import React, { FC, Fragment, useEffect, useRef, useState } from 'react'

import { MetricEntry } from '../../backend/typings'

import {
  last7days,
  lastMonthEnd,
  lastMonthStart,
  lastWeekEnd,
  lastWeekStart,
  lastYearEnd,
  lastYearStart,
  now,
  thisMonth,
  thisWeek,
  thisYear
} from './dates'
import style from './style.scss'
import { fillMissingValues, getNotNaN } from './utils'
import FlatProgressChart from './FlatProgressChart'
import ItemsList from './ItemsList'
import NumberMetric from './NumberMetric'
import RadialMetric from './RadialMetric'
import TimeSeriesChart from './TimeSeriesChart'

interface State {
  previousRangeMetrics: MetricEntry[]
  previousDateRange?: DateRange
  metrics: MetricEntry[]
  dateRange?: DateRange
  pageTitle: string
  selectedChannel: string
  shownSection: string
  disableAnalyticsFetching?: boolean
  topQnaQuestions: { id: string; question?: string; count: number }[]
}

interface ExportPeriod {
  startDate: string
  endDate: string
  metrics: MetricEntry[]
}

export interface Channel {
  label: string
  value: string
}

export interface Extras {
  icon?: IconName | MaybeElement
  iconBottom?: IconName | MaybeElement
  className?: string
}

const navigateToElement = (name: string, type: string) => () => {
  let url
  if (type === 'qna') {
    url = `/modules/qna?id=${name.replace('__qna__', '')}`
  } else if (type === 'workflow') {
    url = `/flows/${name}`
  }
  window.postMessage({ action: 'navigate-url', payload: url }, '*')
}
const isNDU = window['USE_ONEFLOW']

const fetchReducer = (state: State, action): State => {
  if (action.type === 'datesSuccess') {
    const { dateRange } = action.data

    return {
      ...state,
      dateRange,
      disableAnalyticsFetching: false
    }
  } else if (action.type === 'receivedMetrics') {
    const { metrics } = action.data

    return {
      ...state,
      metrics
    }
  } else if (action.type === 'receivedPreviousRangeMetrics') {
    const { metrics, dateRange } = action.data

    return {
      ...state,
      previousDateRange: dateRange,
      previousRangeMetrics: metrics
    }
  } else if (action.type === 'channelSuccess') {
    const { selectedChannel } = action.data

    return {
      ...state,
      selectedChannel
    }
  } else if (action.type === 'sectionChange') {
    const { shownSection, pageTitle } = action.data

    return {
      ...state,
      shownSection,
      pageTitle
    }
  } else if (action.type === 'setManualDate') {
    const { dateRange } = action.data

    return {
      ...state,
      dateRange,
      disableAnalyticsFetching: true
    }
  } else if (action.type === 'receivedTopQnaQuestions') {
    return {
      ...state,
      topQnaQuestions: action.data.topQnaQuestions
    }
  } else {
    throw new Error("That action type isn't supported.")
  }
}

const defaultChannels = [
  { value: 'all', label: lang.tr('module.analytics.channels.all') },
  { value: 'api', label: lang.tr('module.analytics.channels.api') }
]

const qnaQuestionsCache = { found: {}, notFound: new Set<string>() }

const Analytics: FC<any> = ({ bp }) => {
  const loadJson = useRef(null)
  const [channels, setChannels] = useState(defaultChannels)

  const [state, dispatch] = React.useReducer(fetchReducer, {
    dateRange: undefined,
    previousDateRange: undefined,
    metrics: [],
    previousRangeMetrics: [],
    pageTitle: lang.tr('module.analytics.dashboard'),
    selectedChannel: defaultChannels[0].value,
    shownSection: 'dashboard',
    topQnaQuestions: []
  })

  useEffect(() => {
    void axios.get(`${window.origin + window['API_PATH']}/modules`).then(({ data }) => {
      const channels = data
        .map(x => x.name)
        .filter(x => x.startsWith('channel'))
        .map(x => {
          const channel = x.replace('channel-', '')
          return { value: channel, label: capitalize(channel) }
        })

      setChannels(prevState => [...prevState, ...channels])
    })

    dispatch({ type: 'datesSuccess', data: { dateRange: [last7days, now] } })
  }, [])

  useEffect(() => {
    if (!state.dateRange?.[0] || !state.dateRange?.[1] || state.disableAnalyticsFetching) {
      return
    }

    // tslint:disable-next-line: no-floating-promises
    fetchAnalytics(state.selectedChannel, state.dateRange).then(metrics => {
      dispatch({ type: 'receivedMetrics', data: { dateRange: state.dateRange, metrics } })
    })

    /* Get the previous range data so we can compare them and see what changed */
    const startDate = moment(state.dateRange[0])
    const endDate = moment(state.dateRange[1])
    const oldEndDate = moment(state.dateRange[0]).subtract(1, 'days')
    const previousRange = [startDate.subtract(endDate.diff(startDate, 'days') + 1, 'days'), oldEndDate]

    // tslint:disable-next-line: no-floating-promises
    fetchAnalytics(state.selectedChannel, previousRange).then(metrics => {
      dispatch({ type: 'receivedPreviousRangeMetrics', data: { dateRange: previousRange, metrics } })
    })
  }, [state.dateRange, state.selectedChannel])

  useEffect(() => {
    // tslint:disable-next-line: no-floating-promises
    fetchQnaQuestions()
  }, [state.metrics])

  const fetchAnalytics = async (channel: string, dateRange): Promise<MetricEntry[]> => {
    const startDate = moment(dateRange[0]).unix()
    const endDate = moment(dateRange[1]).unix()

    const { data } = await bp.axios.get(`mod/analytics/channel/${channel}`, {
      params: {
        start: startDate,
        end: endDate
      }
    })
    return data.metrics
  }

  const fetchQnaQuestions = async () => {
    const metrics = orderMetrics(getMetric('msg_sent_qna_count').filter(metric => metric.subMetric)).slice(0, 10)

    const topQnaQuestions = await Promise.all(
      metrics.map(async ({ name: id, count }) => {
        if (id in qnaQuestionsCache.found) {
          return { count, id, question: qnaQuestionsCache.found[id] }
        }

        if (qnaQuestionsCache.notFound.has(id)) {
          return { count, id }
        }

        let response
        try {
          response = await fetchQnaQuestion(id.replace('__qna__', ''))
        } catch (e) {
          qnaQuestionsCache.notFound.add(id)
          return { count, id }
        }

        const {
          data: { questions }
        } = response
        const question = (questions[lang.getLocale()] ||
          questions[lang.defaultLocale] ||
          Object.values(questions)[0])[0]
        qnaQuestionsCache.found[id] = question
        return { count, id, question }
      })
    )

    dispatch({
      type: 'receivedTopQnaQuestions',
      data: { topQnaQuestions }
    })
  }

  const fetchQnaQuestion = async (id: string): Promise<any> => {
    const { data } = await bp.axios.get(`mod/qna/questions/${id}`)
    return data
  }

  const handleChannelChange = async ({ target: { value: selectedChannel } }) => {
    dispatch({ type: 'channelSuccess', data: { selectedChannel } })
  }

  const handleDateChange = async (dateRange: DateRange) => {
    dispatch({ type: 'datesSuccess', data: { dateRange } })
  }

  const isLoaded = () => {
    return state.metrics && state.dateRange
  }

  const capitalize = str => str.substring(0, 1).toUpperCase() + str.substring(1)

  const getMetricCount = (metricName: string, subMetric?: string) => {
    const metrics = state.metrics.filter(m => m.metric === metricName && (!subMetric || m.subMetric === subMetric))
    return _.sumBy(metrics, 'value')
  }

  const getPreviousRangeMetricCount = (metricName: string, subMetric?: string) => {
    const previousRangeMetrics = state.previousRangeMetrics.filter(
      m => m.metric === metricName && (!subMetric || m.subMetric === subMetric)
    )
    return _.sumBy(previousRangeMetrics, 'value')
  }

  const getAvgMsgPerSessions = () => {
    const sentCount = state.metrics.reduce((acc, m) => (m.metric === 'msg_sent_count' ? acc + m.value : acc), 0)
    const receivedCount = state.metrics.reduce((acc, m) => (m.metric === 'msg_received_count' ? acc + m.value : acc), 0)

    return sentCount + receivedCount
  }

  const getMisunderStoodData = () => {
    const totalMisunderstood = getMetricCount('msg_nlu_intent', 'none')
    const totalMisunderstoodInside =
      ((totalMisunderstood - getMetricCount('sessions_start_nlu_none')) / totalMisunderstood) * 100
    const totalMisunderstoodOutside = (getMetricCount('sessions_start_nlu_none') / totalMisunderstood) * 100

    return {
      total: totalMisunderstood,
      inside: getNotNaN(totalMisunderstoodInside, '%'),
      outside: getNotNaN(totalMisunderstoodOutside, '%')
    }
  }

  const getReturningUsers = () => {
    const activeUsersCount = getMetricCount('active_users_count')
    const newUsersCount = getMetricCount('new_users_count')
    const percent = Math.round((activeUsersCount / (newUsersCount + activeUsersCount)) * 100)

    return getNotNaN(percent, '%')
  }

  const getNewUsersPercent = () => {
    const existingUsersCount = getMetricCount('active_users_count')
    const newUsersCount = getMetricCount('new_users_count')
    const percent = Math.round((newUsersCount / (existingUsersCount + newUsersCount)) * 100)

    return getNotNaN(percent, '%')
  }

  const getMetric = metricName => state.metrics.filter(x => x.metric === metricName)

  const getTopItems = (
    metricName: string,
    type: string,
    options?: {
      nameRenderer?: (name: string) => string
      filter?: (x: any) => boolean
    }
  ) => {
    const { nameRenderer, filter } = options || {}

    let metrics = getMetric(metricName)
    if (filter) {
      metrics = metrics.filter(filter)
    }
    const results = orderMetrics(metrics)

    return results.map(x => ({
      label: `${nameRenderer ? nameRenderer(x.name) : x.name}`,
      count: x.count,
      href: '',
      onClick: navigateToElement(x.name, type)
    }))
  }

  const orderMetrics = metrics => {
    const grouped = _.groupBy(metrics, 'subMetric')
    return _.orderBy(
      Object.keys(grouped).map(x => ({ name: x, count: _.sumBy(grouped[x], 'value') })),
      x => x.count,
      'desc'
    )
  }

  const renderEngagement = () => {
    const newUserCountDiff = getMetricCount('new_users_count') - getPreviousRangeMetricCount('new_users_count')
    const activeUserCountDiff = getMetricCount('active_users_count') - getPreviousRangeMetricCount('active_users_count')
    const activeUsers = fillMissingValues(getMetric('active_users_count'), state.dateRange[0], state.dateRange[1])

    return (
      <div className={style.metricsContainer}>
        <NumberMetric
          className={style.half}
          diffFromPreviousRange={newUserCountDiff}
          previousDateRange={state.previousDateRange}
          name={lang.tr('module.analytics.newUsers', { nb: getMetricCount('new_users_count') })}
          value={getNewUsersPercent()}
        />
        <NumberMetric
          className={style.half}
          diffFromPreviousRange={activeUserCountDiff}
          previousDateRange={state.previousDateRange}
          name={lang.tr('module.analytics.returningUsers', { nb: getMetricCount('active_users_count') })}
          value={getReturningUsers()}
        />
        <TimeSeriesChart
          name={lang.tr('module.analytics.userActivities')}
          data={activeUsers}
          className={style.fullGrid}
          channels={channels}
        />
      </div>
    )
  }

  const renderConversations = () => {
    const sessionsCount = fillMissingValues(getMetric('sessions_count'), state.dateRange[0], state.dateRange[1])

    return (
      <div className={style.metricsContainer}>
        <TimeSeriesChart name="Sessions" data={sessionsCount} className={style.fullGrid} channels={channels} />
        <NumberMetric
          className={style.half}
          name={lang.tr('module.analytics.messageExchanged')}
          value={getAvgMsgPerSessions()}
          iconBottom="chat"
        />
        {isNDU && (
          <NumberMetric
            name={lang.tr('module.analytics.workflowsInitiated')}
            value={getMetricCount('workflow_started_count')}
            className={style.half}
          />
        )}
        <NumberMetric
          name={lang.tr('module.analytics.questionsAsked')}
          value={getMetricCount('msg_sent_qna_count')}
          className={style.half}
        />
        <ItemsList
          name={lang.tr('module.analytics.mostUsedWorkflows')}
          items={getTopItems('enter_flow_count', 'workflow')}
          itemLimit={10}
          className={cx(style.genericMetric, style.half, style.list)}
        />
        <ItemsList
          name={lang.tr('module.analytics.mostAskedQuestions')}
          items={state.topQnaQuestions.map(q => ({
            count: q.count,
            label: q.question || renderDeletedQna(q.id),
            onClick: q.question ? navigateToElement(q.id, 'qna') : undefined
          }))}
          className={cx(style.genericMetric, style.half, style.list)}
        />
      </div>
    )
  }

  const renderDeletedQna = (id: string) =>
    `[${lang.tr('module.analytics.deletedQna')}, ID: ${id.replace('__qna__', '')}]`

  const getLanguagesData = () => {
    const metrics = state.metrics.filter(m => m.metric === 'msg_nlu_language')
    if (metrics.length === 0) {
      return []
    }

    const total = _.sum(metrics.map(m => m.value))

    return _.sortBy(metrics, m => m.value)
      .reverse()
      .map(m => ({ value: getNotNaN((m.value / total) * 100, '%'), language: m.subMetric }))
  }

  const renderHandlingUnderstanding = () => {
    const misunderstood = getMisunderStoodData()
    const languages = getLanguagesData()
    const positiveFeedback = getMetricCount('feedback_positive_qna')
    const negativeFeedback = getMetricCount('feedback_negative_qna')
    const positivePct = Math.round((positiveFeedback / (positiveFeedback + negativeFeedback)) * 100)

    return (
      <div className={cx(style.metricsContainer, style.fullWidth)}>
        <div className={cx(style.genericMetric, style.quarter)}>
          <div>
            <p className={style.numberMetricValue}>{misunderstood.total}</p>
            <h3 className={style.metricName}>{lang.tr('module.analytics.misunderstoodMessages')}</h3>
          </div>
          <div>
            <FlatProgressChart
              value={misunderstood.inside}
              color="#DE4343"
              name={`${misunderstood.inside} inside flows`}
            />
            <FlatProgressChart
              value={misunderstood.outside}
              color="#F2B824"
              name={`${misunderstood.outside} outside flows`}
            />
          </div>
        </div>
        <div className={cx(style.genericMetric, style.quarter)}>
          <div>
            <h3 className={style.metricName}>{lang.tr('module.analytics.messagesByLanguage')}</h3>
          </div>
          <div>
            {languages.map(i => (
              <FlatProgressChart
                value={i.value}
                color="#F2B824"
                name={`${lang.tr(`isoLangs.${i.language}.name`)}: ${i.value}`}
              />
            ))}
          </div>
        </div>
        {isNDU && (
          <Fragment>
            <div className={cx(style.genericMetric, style.quarter, style.list, style.multiple)}>
              <ItemsList
                name={lang.tr('module.analytics.mostFailedWorkflows')}
                items={getTopItems('workflow_failed_count', 'workflow')}
                itemLimit={3}
                className={style.list}
              />
              {/* <ItemsList
                name={lang.tr('module.analytics.mostFailedQuestions')}
                items={getTopItems('feedback_negative_qna', 'qna')}
                itemLimit={3}
                hasTooltip
                className={style.list}
              /> */}
            </div>
            <RadialMetric
              name={lang.tr('module.analytics.successfulWorkflowCompletions', {
                nb: getMetricCount('workflow_completed_count')
              })}
              value={Math.round(
                (getMetricCount('workflow_completed_count') / getMetricCount('workflow_started_count')) * 100
              )}
              className={style.quarter}
            />
            <RadialMetric
              name={lang.tr('module.analytics.positiveQnaFeedback', { nb: positiveFeedback })}
              value={isNaN(positivePct) ? 0 : positivePct}
              className={style.quarter}
            />
          </Fragment>
        )}
      </div>
    )
  }

  if (!isLoaded()) {
    return null
  }

  const shortcuts: IDateRangeShortcut[] = [
    {
      dateRange: [thisWeek, now],
      label: lang.tr('module.analytics.timespan.thisWeek')
    },
    {
      dateRange: [lastWeekStart, lastWeekEnd],
      label: lang.tr('module.analytics.timespan.lastWeek')
    },
    {
      dateRange: [thisMonth, now],
      label: lang.tr('module.analytics.timespan.thisMonth')
    },
    {
      dateRange: [lastMonthStart, lastMonthEnd],
      label: lang.tr('module.analytics.timespan.lastMonth')
    },
    {
      dateRange: [thisYear, now],
      label: lang.tr('module.analytics.timespan.thisYear')
    },
    {
      dateRange: [lastYearStart, lastYearEnd],
      label: lang.tr('module.analytics.timespan.lastYear')
    }
  ]

  const exportCsv = async () => {
    const data = [
      '"date","botId","channel","metric","subMetric","value"',
      ...state.metrics.map(entry => {
        return [entry.date, entry.botId, entry.channel, entry.metric, entry.subMetric, entry.value]
          .map(x => (x || 'N/A').toString().replace(/"/g, '\\"'))
          .map(x => `"${x}"`)
          .join(',')
      })
    ].join('\r\n')

    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([data]))
    link.download = 'analytics.csv'
    link.click()
  }
  const exportJson = () => {
    const { dateRange, metrics, previousDateRange, previousRangeMetrics } = state
    const formatDate = date => moment(date).format('YYYY-MM-DD')

    const json: ExportPeriod[] = [
      {
        startDate: formatDate(dateRange?.[0]),
        endDate: formatDate(dateRange?.[1]),
        metrics: _.sortBy(metrics, ['metric', 'date'])
      },
      {
        startDate: formatDate(previousDateRange?.[0]),
        endDate: formatDate(previousDateRange?.[1]),
        metrics: _.sortBy(previousRangeMetrics, ['metric', 'date'])
      }
    ]

    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([JSON.stringify(json, undefined, 2)]))
    link.download = 'analytics.json'
    link.click()
  }

  const readFile = (e: any) => {
    const fr = new FileReader()
    fr.readAsArrayBuffer((e.target as HTMLInputElement).files[0])
    fr.onload = loadedEvent => {
      try {
        const dec = new TextDecoder('utf-8')
        const content = JSON.parse(dec.decode(_.get(loadedEvent, 'target.result'))) as ExportPeriod[]

        const loadDateRange = (type, data) => {
          const { startDate, endDate, metrics } = data
          dispatch({ type, data: { dateRange: [startDate, endDate], metrics } })
        }

        const [currentPeriod, prevPeriod] = content

        loadDateRange('receivedMetrics', currentPeriod)
        loadDateRange('receivedPreviousRangeMetrics', prevPeriod)

        dispatch({
          type: 'setManualDate',
          data: { dateRange: [moment(currentPeriod.startDate).toDate(), moment(currentPeriod.endDate).toDate()] }
        })
      } catch (err) {
        console.error('Could not load metrics', err)
      }
    }
  }

  return (
    <div className={style.mainWrapper}>
      <div className={style.innerWrapper}>
        <div className={style.header}>
          <h1 className={style.pageTitle} onDoubleClick={() => loadJson.current.click()}>
            {lang.tr('module.analytics.title')}
          </h1>
          <div className={style.filters}>
            <BpTooltip content={lang.tr('module.analytics.filterChannels')} position={Position.LEFT}>
              <HTMLSelect className={style.filterItem} onChange={handleChannelChange} value={state.selectedChannel}>
                {channels.map(channel => {
                  return (
                    <option key={channel.value} value={channel.value}>
                      {channel.label}
                    </option>
                  )
                })}
              </HTMLSelect>
            </BpTooltip>

            <Popover>
              <Button icon="calendar" className={style.filterItem}>
                {lang.tr('module.analytics.dateRange')}
              </Button>
              <DateRangePicker
                onChange={handleDateChange}
                allowSingleDayRange={true}
                shortcuts={shortcuts}
                maxDate={new Date()}
                value={state.dateRange}
              />
            </Popover>

            <Popover
              content={
                <div style={{ padding: 5 }}>
                  <ButtonGroup>
                    <Button onClick={exportCsv} text={lang.tr('module.analytics.exportCsv')}></Button>
                    <Button onClick={exportJson} text={lang.tr('module.analytics.exportJson')}></Button>
                  </ButtonGroup>
                </div>
              }
              position={Position.BOTTOM}
            >
              <Button className={style.exportButton} icon="export" text={lang.tr('module.analytics.export')}></Button>
            </Popover>
          </div>
        </div>
        <div className={style.sectionsWrapper}>
          <div className={cx(style.section, style.half)}>
            <h2>{lang.tr('module.analytics.engagement')}</h2>
            {renderEngagement()}
          </div>
          <div className={cx(style.section, style.half)}>
            <h2>{lang.tr('module.analytics.conversations')}</h2>
            {renderConversations()}
          </div>
          <div className={style.section}>
            <h2>{lang.tr('module.analytics.handlingAndUnderstanding')}</h2>
            {renderHandlingUnderstanding()}
          </div>
        </div>
        <input type="file" ref={loadJson} onChange={readFile} style={{ visibility: 'hidden' }}></input>
      </div>
    </div>
  )
}

export default Analytics
