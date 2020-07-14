import { Button, Icon } from '@blueprintjs/core'
import Tags from '@yaireo/tagify/dist/react.tagify'
import cx from 'classnames'
import React, { Fragment, useEffect, useRef, useState } from 'react'

import { lang } from '../../translations'
import { FieldProps } from '../../Contents/Components/typings'
import Dropdown from '../../Dropdown'
import Icons from '../../Icons'

import style from './style.scss'
import { SuperInputProps } from './typings'
import { convertToString, convertToTags } from './utils'

type Props = FieldProps & SuperInputProps

export default ({
  canAddElements = true,
  canPickEvents = true,
  defaultVariableType = 'string',
  events,
  multiple,
  variables,
  addVariable,
  setCanOutsideClickClose,
  onBlur,
  value
}: Props) => {
  const currentPrefix = useRef<string>()
  const tagifyRef = useRef<any>()
  const [localVariables, setLocalVariables] = useState(variables?.map(({ name }) => name) || [])
  const [localEvents, setLocalEvents] = useState(events?.map(({ name }) => name) || [])
  const eventsDesc = events?.reduce((acc, event) => ({ ...acc, [event.name]: event.description }), {})
  // TODO implement the autocomplete selection when event selected is partial

  useEffect(() => {
    setLocalVariables(variables?.map(({ name }) => name) || [])
  }, [variables])

  useEffect(() => {
    setLocalEvents(events?.map(({ name }) => name) || [])
  }, [events])

  const tagifyCallbacks = {
    add: e => {
      const value = e.detail.data.value
      const isAdding = !tagifyRef.current.settings.whitelist.includes(value)
      console.log(e)
      if (isAdding) {
        const newVariable = {
          type: defaultVariableType,
          name: value
        }
        setLocalVariables([...localVariables, value])
        console.log(tagifyRef.current.getMixedTagsAsString())
        addVariable?.(newVariable)
      }
    },
    ['dropdown:select']: e => {
      console.log(e)
    },
    input: e => {
      const prefix = e.detail.prefix
      currentPrefix.current = prefix

      if (prefix && multiple) {
        if (prefix === '$') {
          tagifyRef.current.settings.whitelist = localVariables
        }

        if (prefix === '{{') {
          // TODO refactor to use the schema format properly and allow to breakdown into an object type search
          tagifyRef.current.settings.whitelist = localEvents
        }

        if (e.detail.value.length > 1) {
          e.detail.tagify.dropdown.show.call(e.detail.tagify, e.detail.value)
        }
      }
    },
    keydown: e => {
      const originalEvent = e.detail.originalEvent

      if ((originalEvent.ctrlKey || originalEvent.metaKey) && originalEvent.key === 'a') {
        document.execCommand('selectAll', true)
      }
    },
    ['dropdown:show']: e => {
      setCanOutsideClickClose?.(false)
    },
    ['edit:start']: e => {
      const prefix = e.detail.data.prefix

      if (prefix === '$') {
        tagifyRef.current.settings.whitelist = localVariables
      }

      if (prefix === '{{') {
        // TODO refactor to use the schema format properly and allow to breakdown into an object type search
        tagifyRef.current.settings.whitelist = localEvents
      }
    }
  }

  const addPrefix = prefix => {
    let currentContent = tagifyRef.current?.DOM.input.innerHTML

    if (currentContent.endsWith('{{')) {
      currentContent = currentContent.slice(0, -2).trim()
    }
    if (currentContent.endsWith('$')) {
      currentContent = currentContent.slice(0, -1).trim()
    }

    // @ts-ignore
    tagifyRef.current?.DOM?.input?.innerHTML = currentContent

    if (currentContent !== '' && !currentContent.endsWith('&nbsp;')) {
      addSpace()
    }

    appendNodeToInput(document.createTextNode(prefix))
    moveCarretToEndOfString()
  }

  const appendNodeToInput = node => {
    tagifyRef.current?.DOM.input.appendChild(node)
  }

  const addSpace = () => {
    appendNodeToInput(document.createTextNode('\u00A0'))
  }

  const moveCarretToEndOfString = () => {
    tagifyRef.current?.DOM.input.focus()
    document.execCommand('selectAll', false)
    document.getSelection()?.collapseToEnd()
    tagifyRef.current?.DOM.input.dispatchEvent(new Event('input', { bubbles: true }))
  }

  const getSingleTagHtml = () => {
    const tag =
      value &&
      JSON.parse(
        convertToTags(value)
          .replace('[[', '')
          .replace(']]', '')
      )

    return (
      tag && (
        <span contentEditable={false} title={tag.value} tabIndex={-1} className="tagify__tag">
          <span>
            <Icon icon={tag.prefix === '$' ? 'dollar' : <Icons.Brackets iconSize={10} />} iconSize={10} />
            <span className="tagify__tag-text">{tag.value}</span>
          </span>
        </span>
      )
    )
  }

  const singularTagKeyDown = e => {
    e.preventDefault()

    if (e.key === 'Backspace') {
      onBlur?.('')
    }
  }

  if (!multiple) {
    return (
      <div className={style.superInputWrapper}>
        <div className={style.singularTagBtnWrapper}>
          {canPickEvents && (
            <Dropdown
              items={localEvents.map(name => ({ value: name, label: name }))}
              icon={<Icons.Brackets />}
              onChange={({ value }) => {
                onBlur?.(`{{${value}}}`)
              }}
            />
          )}
          <Dropdown
            items={localVariables.map(name => ({ value: name, label: name }))}
            icon="dollar"
            onChange={({ value }) => {
              onBlur?.(`$${value}`)
            }}
          />
        </div>
        <div className={style.superInput} onKeyDown={singularTagKeyDown} contentEditable suppressContentEditableWarning>
          {getSingleTagHtml()}
        </div>
      </div>
    )
  }

  return (
    <div className={style.superInputWrapper}>
      <div className={style.tagBtnWrapper}>
        {canPickEvents && (
          <Button
            className={style.tagBtn}
            onClick={() => {
              addPrefix('{{')
            }}
            icon={<Icons.Brackets />}
          />
        )}
        <Button
          className={style.tagBtn}
          onClick={() => {
            addPrefix('$')
          }}
          icon="dollar"
        />
      </div>
      {/*<Tags
        className={style.superInput}
        tagifyRef={tagifyRef}
        settings={{
          dropdown: {
            classname: 'color-blue',
            enabled: 0,
            maxItems: 5,
            position: 'below',
            closeOnSelect: true,
            highlightFirst: true
          },
          templates: {
            tag(tagData, data) {
              const isValid = (data.prefix === '$' ? localVariables : localEvents).find(name => name === tagData)

              return (
                <span
                  title="${tagData}"
                  contentEditable={false}
                  spellCheck={false}
                  tabIndex={-1}
                  className={cx('tagify__tag', { ['tagify--invalid']: isValid })}
                >
                  <span>
                    <Icon icon={data.prefix === '$' ? 'dollar' : <Icons.Brackets iconSize={10} />} iconSize={10} />
                    <span className="tagify__tag-text">${tagData}</span>
                  </span>
                </span>
              )
            },
            dropdown(settings) {
              return (
                <div
                  className={cx(style.dropdown, 'tagify__dropdown tagify__dropdown--below')}
                  role="listbox"
                  aria-labelledby="dropdown"
                >
                  <div className="tagify__dropdown__wrapper"></div>
                </div>
              )
            },
            dropdownItem(item) {
              const isAdding = !tagifyRef.current.settings.whitelist.includes(item.value)
              const string = isAdding ? `"${item.value}"` : item.value

              if (isAdding && (currentPrefix.current === '{{' || !canAddElements)) {
                return null
              }

              // TODO add icon when variable supports them and add variables description when they exist
              return (
                <div
                  className={cx('tagify__dropdown__item', { [style.addingItem]: isAdding })}
                  tabIndex={0}
                  role="option"
                >
                  {isAdding && (
                    <Fragment>
                      <Icon icon="plus" iconSize={12} />
                      {lang('create')}
                    </Fragment>
                  )}
                  {string}
                  <span className="description">{eventsDesc?.[item.value] || ''}</span>
                </div>
              )
            }
          },
          duplicates: true,
          callbacks: tagifyCallbacks,
          mode: 'mix',
          pattern: canPickEvents ? /\$|{{/ : /\$/
        }}
        value={convertToTags(value!)}
        onChange={e => (e.persist(), onBlur?.(convertToString(e.target.value)))}
      />*/}
      <Tags
        settings={{
          dropdown: {
            classname: 'color-blue',
            enabled: 0,
            maxItems: 5,
            position: 'below',
            closeOnSelect: true,
            highlightFirst: true
          },
          callbacks: tagifyCallbacks,
          mode: 'mix',
          pattern: canPickEvents ? /\$|{{/ : /\$/
        }}
        className={style.superInput}
        tagifyRef={tagifyRef}
      />
    </div>
  )
}
