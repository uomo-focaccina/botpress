import * as sdk from 'botpress/sdk'
import _ from 'lodash'

import { POSClass } from '../language/pos-tagger'
import { SPECIAL_CHARSET } from '../tools/chars'
import { computeNorm, scalarDivide, scalarMultiply, vectorAdd } from '../tools/math'
import { replaceConsecutiveSpaces } from '../tools/strings'
import { convertToRealSpaces, isSpace, isWord, SPACE } from '../tools/token-utils'
import { getClosestToken } from '../tools/vocab'
import { ExtractedEntity, ExtractedSlot, TFIDF, Token2Vec, Tools } from '../typings'

import { parseUtterance } from './utterance-parser'

export interface UtteranceToStringOptions {
  lowerCase?: boolean
  onlyWords?: boolean
  slots?: 'keep-value' | 'keep-name' | 'ignore'
  entities?: 'keep-default' | 'keep-value' | 'keep-name' | 'ignore'
}

export interface TokenToStringOptions {
  lowerCase?: boolean
  trim?: boolean
  realSpaces?: boolean
}

export interface UtteranceRange {
  startTokenIdx: number
  endTokenIdx: number
  startPos: number
  endPos: number
}
export type UtteranceEntity = Readonly<UtteranceRange & ExtractedEntity>
export type UtteranceSlot = Readonly<UtteranceRange & ExtractedSlot>
export type UtteranceToken = Readonly<{
  index: number
  value: string
  isWord: boolean
  isSpace: boolean
  isBOS: boolean
  isEOS: boolean
  POS: POSClass
  vector: ReadonlyArray<number>
  tfidf: number
  cluster: number
  offset: number
  entities: ReadonlyArray<UtteranceEntity>
  slots: ReadonlyArray<UtteranceSlot>
  toString(options?: TokenToStringOptions): string
}>

export const DefaultTokenToStringOptions: TokenToStringOptions = { lowerCase: false, realSpaces: true, trim: false }

export default class Utterance {
  public slots: ReadonlyArray<UtteranceSlot> = []
  public entities: ReadonlyArray<UtteranceEntity> = []
  private _tokens: ReadonlyArray<UtteranceToken> = []
  private _globalTfidf?: TFIDF
  private _kmeans?: sdk.MLToolkit.KMeans.KmeansResult
  private _sentenceEmbedding?: number[]

  constructor(tokens: string[], vectors: number[][], posTags: POSClass[], public languageCode: Readonly<string>) {
    const allSameLength = [tokens, vectors, posTags].every(arr => arr.length === tokens.length)
    if (!allSameLength) {
      throw Error('Tokens, vectors and postTags dimensions must match')
    }

    const arr: UtteranceToken[] = []
    for (let i = 0, offset = 0; i < tokens.length; i++) {
      const that = this
      const value = tokens[i]
      arr.push(
        Object.freeze({
          index: i,
          isBOS: i === 0,
          isEOS: i === tokens.length - 1,
          isWord: isWord(value),
          offset,
          isSpace: isSpace(value),
          get slots(): ReadonlyArray<UtteranceRange & ExtractedSlot> {
            return that.slots.filter(x => x.startTokenIdx <= i && x.endTokenIdx >= i)
          },
          get entities(): ReadonlyArray<UtteranceRange & ExtractedEntity> {
            return that.entities.filter(x => x.startTokenIdx <= i && x.endTokenIdx >= i)
          },
          get tfidf(): number {
            return (that._globalTfidf && that._globalTfidf[value]) || 1
          },
          get cluster(): number {
            const wordVec = vectors[i]
            return (that._kmeans && that._kmeans.nearest([wordVec])[0]) || 1
          },
          value,
          vector: vectors[i],
          POS: posTags[i],
          toString: (opts: TokenToStringOptions = {}) => {
            const options = { ...DefaultTokenToStringOptions, ...opts }
            let result = value
            if (options.lowerCase) {
              result = result.toLowerCase()
            }
            if (options.realSpaces) {
              result = convertToRealSpaces(result)
            }
            if (options.trim) {
              result = result.trim()
            }
            return result
          }
        }) as UtteranceToken
      )
      offset += value.length
    }
    this._tokens = arr
  }

  get tokens(): ReadonlyArray<UtteranceToken> {
    return this._tokens
  }

  get sentenceEmbedding(): number[] {
    if (this._sentenceEmbedding) {
      return this._sentenceEmbedding
    }

    let totalWeight = 0
    const dims = this._tokens[0].vector.length
    let sentenceEmbedding = new Array(dims).fill(0)

    // Algorithm strongly inspired by Fasttext classifier (see method FastText::getSentenceVector)
    for (const token of this.tokens) {
      const norm = computeNorm(token.vector as number[])
      if (norm <= 0 || !token.isWord) {
        // ignore special char tokens in sentence embeddings
        continue
      }

      const weight = Math.min(1, token.tfidf) // TODO: there's already an upper limit on TFIDF
      totalWeight += weight
      const weightedVec = scalarMultiply(token.vector as number[], weight / norm) // TODO: experiment without dividing by norm
      sentenceEmbedding = vectorAdd(sentenceEmbedding, weightedVec)
    }

    this._sentenceEmbedding = scalarDivide(sentenceEmbedding, totalWeight)
    return this._sentenceEmbedding
  }

  setGlobalTfidf(tfidf: TFIDF) {
    this._globalTfidf = tfidf
  }

  setKmeans(kmeans?: sdk.MLToolkit.KMeans.KmeansResult) {
    this._kmeans = kmeans
  }

  // TODO memoize this for better perf
  toString(opt?: UtteranceToStringOptions): string {
    const options: UtteranceToStringOptions = _.defaultsDeep({}, opt, { lowerCase: false, slots: 'keep-value' })

    let final = ''
    let ret = [...this.tokens]
    if (options.onlyWords) {
      ret = ret.filter(tok => tok.slots.length || tok.isWord)
    }

    for (const tok of ret) {
      let toAdd = ''
      if (!tok.slots.length && !tok.entities.length) {
        toAdd = tok.value
      }

      // case ignore is handled implicitly
      if (tok.slots.length && options.slots === 'keep-name') {
        toAdd = tok.slots[0].name
      } else if (tok.slots.length && options.slots === 'keep-value') {
        toAdd = tok.value
      } else if (tok.entities.length && options.entities === 'keep-name') {
        toAdd = tok.entities[0].type
      } else if (tok.entities.length && options.entities === 'keep-value') {
        toAdd = tok.entities[0].value.toString()
      } else if (tok.entities.length && options.entities === 'keep-default') {
        toAdd = tok.value
      }

      final += toAdd
    }

    if (options.lowerCase) {
      final = final.toLowerCase()
    }

    return final.replace(new RegExp(SPACE, 'g'), ' ')
  }

  clone(copyEntities: boolean, copySlots: boolean): Utterance {
    const tokens = this.tokens.map(x => x.value)
    const vectors = this.tokens.map(x => <number[]>x.vector)
    const POStags = this.tokens.map(x => x.POS)
    const utterance = new Utterance(tokens, vectors, POStags, this.languageCode)
    utterance.setGlobalTfidf({ ...this._globalTfidf })

    if (copyEntities) {
      this.entities.forEach(entity => utterance.tagEntity(entity, entity.startPos, entity.endPos))
    }

    if (copySlots) {
      this.slots.forEach(slot => utterance.tagSlot(slot, slot.startPos, slot.endPos))
    }

    return utterance
  }

  private _validateRange(start: number, end: number) {
    const lastTok = _.last(this._tokens)
    const maxEnd = _.get(lastTok, 'offset', 0) + _.get(lastTok, 'value.length', 0)

    if (start < 0 || start > end || start > maxEnd || end > maxEnd) {
      throw new Error('Invalid range')
    }
  }

  tagEntity(entity: ExtractedEntity, start: number, end: number) {
    this._validateRange(start, end)
    const range = this.tokens.filter(x => x.offset >= start && x.offset + x.value.length <= end)
    if (_.isEmpty(range)) {
      return
    }
    const entityWithPos = {
      ...entity,
      startPos: start,
      endPos: end,
      startTokenIdx: _.first(range)!.index,
      endTokenIdx: _.last(range)!.index
    }

    this.entities = [...this.entities, entityWithPos]
  }

  tagSlot(slot: ExtractedSlot, start: number, end: number) {
    this._validateRange(start, end)
    const range = this.tokens.filter(x => x.offset >= start && x.offset + x.value.length <= end)
    if (_.isEmpty(range)) {
      return
    }

    const taggedSlot = {
      ...slot,
      startPos: start,
      endPos: end,
      startTokenIdx: _.first(range)!.index,
      endTokenIdx: _.last(range)!.index
    }

    this.slots = [...this.slots, taggedSlot]
  }
}

export async function buildUtteranceBatch(
  raw_utterances: string[],
  language: string,
  tools: Tools,
  vocab?: Token2Vec
): Promise<Utterance[]> {
  const parsed = raw_utterances.map(u => parseUtterance(replaceConsecutiveSpaces(u)))
  const tokenUtterances = await tools.tokenize_utterances(
    parsed.map(p => p.utterance),
    language,
    vocab
  )
  const POSUtterances = tools.partOfSpeechUtterances(tokenUtterances, language) as POSClass[][]
  const uniqTokens = _.uniq(_.flatten(tokenUtterances))
  const vectors = await tools.vectorize_tokens(uniqTokens, language)
  const vectorMap = _.zipObject(uniqTokens, vectors)

  return _.zipWith(tokenUtterances, POSUtterances, parsed, (tokUtt, POSUtt, parsed) => ({ tokUtt, POSUtt, parsed }))
    .filter(({ tokUtt }) => tokUtt.length)
    .map(({ tokUtt, POSUtt, parsed }) => {
      const { utterance: utt, parsedSlots } = parsed
      const vectors = tokUtt.map(t => vectorMap[t])
      const utterance = new Utterance(tokUtt, vectors, POSUtt, language)

      // TODO: temporary work-around
      // covers a corner case where tokenization returns tokens that are not identical to `parsed` utterance
      // the corner case is when there's a trailing space inside a slot at the end of the utterance, e.g. `my name is [Sylvain ](any)`
      if (utterance.toString().length === utt.length) {
        parsedSlots.forEach(s => {
          utterance.tagSlot(
            { name: s.name, source: s.value, value: s.value, confidence: 1 },
            s.cleanPosition.start,
            s.cleanPosition.end
          )
        })
      } // else we skip the slot

      return utterance
    })
}

interface AlternateToken {
  value: string
  vector: number[] | ReadonlyArray<number>
  POS: POSClass
  isAlter?: boolean
}

function uttTok2altTok(token: UtteranceToken): AlternateToken {
  return {
    ..._.pick(token, ['vector', 'POS']),
    value: token.toString(),
    isAlter: false
  }
}

function isClosestTokenValid(originalToken: UtteranceToken, closestToken: string): boolean {
  return isWord(closestToken) && originalToken.value.length > 3 && closestToken.length > 3
}

/**
 * @description Returns slightly different version of the given utterance, replacing OOV tokens with their closest IV syntaxical neighbour
 * @param utterance the original utterance
 * @param vocabVectors Bot wide vocabulary
 */
export function getAlternateUtterance(utterance: Utterance, vocabVectors: Token2Vec): Utterance | undefined {
  return _.chain(utterance.tokens)
    .map(token => {
      const strTok = token.toString({ lowerCase: true })
      if (!token.isWord || vocabVectors[strTok] || !_.isEmpty(token.entities)) {
        return uttTok2altTok(token)
      }

      const closestToken = getClosestToken(strTok, token.vector, vocabVectors, false)
      if (isClosestTokenValid(token, closestToken)) {
        return {
          value: closestToken,
          vector: vocabVectors[closestToken],
          POS: token.POS,
          isAlter: true
        } as AlternateToken
      } else {
        return uttTok2altTok(token)
      }
    })
    .thru((altToks: AlternateToken[]) => {
      const hasAlternate = altToks.length === utterance.tokens.length && altToks.some(t => t.isAlter)
      if (hasAlternate) {
        return new Utterance(
          altToks.map(t => t.value),
          altToks.map(t => <number[]>t.vector),
          altToks.map(t => t.POS),
          utterance.languageCode
        )
      }
    })
    .value()
}

/**
 * @description Utility function that returns an utterance using a space tokenizer
 * @param str sentence as a textual value
 */
export function makeTestUtterance(str: string): Utterance {
  const toks = str.split(new RegExp(`(${SPECIAL_CHARSET.join('|')}|\\s)`, 'gi'))
  const vecs = new Array(toks.length).fill([0])
  const pos = new Array(toks.length).fill('N/A')
  return new Utterance(toks, vecs, pos, 'en')
}
