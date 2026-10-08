import test from 'node:test'
import assert from 'node:assert/strict'
import { createNavigationMap } from '../server/navigationMap.js'

test('frontier target prefers unexplored boundary over revisited free cells', () => {
  const nav = createNavigationMap()
  nav.observe({robot:{x:0,y:0},obstacles:[]})
  nav.observe({robot:{x:20,y:0},obstacles:[]})
  const t = nav.chooseTarget({robot:{x:20,y:0}})
  assert.equal(t.frontier, true)
  assert.equal(t.x, 2)
})

test('frontier exploration skips blocked cells', () => {
  const nav = createNavigationMap()
  nav.observe({robot:{x:0,y:0},obstacles:[{x:20,y:0,confidence:1}]})
  const t = nav.chooseTarget({robot:{x:0,y:0}})
  assert.notEqual(t.x, 1)
})
