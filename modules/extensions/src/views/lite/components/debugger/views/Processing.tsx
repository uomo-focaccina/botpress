import { Icon } from '@blueprintjs/core'
import sdk from 'botpress/sdk'
import cx from 'classnames'
import _ from 'lodash'
import moment from 'moment'
import React, { FC, Fragment, useState } from 'react'

import ContentSection from '../../../../../../../../src/bp/ui-shared-lite/ContentSection'
import ToolTip from '../../../../../../../../src/bp/ui-shared-lite/ToolTip'
import lang from '../../../../lang'
import style from '../style.scss'

export const Processing: FC<{ processing: { [activity: string]: sdk.IO.ProcessingEntry } }> = props => {
  const [expanded, setExpanded] = useState({})
  const { processing } = props
  let isBeforeMW = true

  const processed = Object.keys(processing)
    .map(key => {
      const [type, name, status] = key.split(':')
      return { type, name, status, completed: moment(processing[key].date), ...processing[key] }
    })
    .map((curr, idx, array) => {
      return { ...curr, execTime: idx === 0 ? 0 : curr.completed.diff(array[idx - 1].completed) }
    })
    .filter(x => x.status !== 'skipped')
    .reduce((acc, item) => {
      const lastItem = acc.pop()
      if (lastItem?.type === item.type) {
        lastItem.subItems?.push(item)
        acc = acc.concat(lastItem)
      } else {
        if (lastItem) {
          acc = acc.concat(lastItem)
        }
        if (isBeforeMW && item.type === 'mw') {
          isBeforeMW = false
        }
        let name = lang.tr(`module.extensions.processing.${item.type}`)

        if (isBeforeMW && item.type === 'hook') {
          name = lang.tr('module.extensions.processing.beforeMW')
        } else if (!isBeforeMW && item.type === 'hook') {
          name = lang.tr('module.extensions.processing.afterMW')
        }
        acc = acc.concat({ type: item.type, name, subItems: [item] })
      }
      return acc
    }, [])

  const renderToggleItem = (item, key) => {
    const isExpanded = expanded[key]
    const hasError = item.status === 'error' || !!item.errors?.length
    const hasLog = !!item.logs?.length

    return (
      <Fragment>
        <ToolTip content={lang.tr('module.extensions.processing.executedIn', { n: item.execTime || 0 })}>
          <button className={style.itemButton} onClick={() => setExpanded({ ...expanded, [key]: !isExpanded })}>
            <Icon className={style.itemButtonIcon} icon={isExpanded ? 'chevron-down' : 'chevron-right'} iconSize={10} />
            {hasError && <Icon className={style.error} icon="error" iconSize={10} />}
            {hasLog && <Icon className={style.info} icon="info-sign" iconSize={10} />}
            <span className={cx({ [style.error]: hasError })}>{item.name}</span>
          </button>
        </ToolTip>
        {isExpanded && (
          <span className={style.expanded}>
            {hasLog && (
              <span className={style.infoBox}>
                {item.logs.map(log => (
                  <div key={log.substr(0, 20)}>{log}</div>
                ))}
              </span>
            )}

            {hasError && (
              <span className={style.infoBox}>
                {item.errors.map(entry => (
                  <div key={entry.stacktrace}>
                    <b>{lang.tr('module.extensions.processing.type')}:</b> {entry.type}
                    <br />
                    <b>{lang.tr('module.extensions.processing.stacktrace')}:</b> {entry.stacktrace}
                  </div>
                ))}
              </span>
            )}
          </span>
        )}
      </Fragment>
    )
  }

  const renderItem = (item, key) => {
    const hasError = item.status === 'error' || !!item.errors?.length
    const hasLog = !!item.logs?.length

    if (hasError || hasLog) {
      return renderToggleItem(item, key)
    }

    return (
      <ToolTip content={lang.tr('module.extensions.processing.executedIn', { n: item.execTime || 0 })}>
        <div className={style.processingItemName}>{item.name}</div>
      </ToolTip>
    )
  }

  return (
    <ContentSection>
      {processed.map((item, index) => {
        const hasChildren = item.subItems?.filter(x => x.name).length

        return (
          <Fragment key={index}>
            {!item.subItems}
            <div className={cx(style.processingItem, style.processingSection)}>
              {!hasChildren && renderItem({ ...item.subItems?.[0], name: item.name }, index)}
              {!!hasChildren && item.name}
            </div>
            {!!hasChildren && (
              <ul>
                {item.subItems?.map((entry, idx) => {
                  const key = `${index}-${idx}`

                  return (
                    <li className={cx(style.processingItem, { [style.error]: entry.status === 'error' })} key={key}>
                      {renderItem(entry, key)}
                    </li>
                  )
                })}
              </ul>
            )}
          </Fragment>
        )
      })}
    </ContentSection>
  )
}
