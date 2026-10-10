import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setReviewId, startScreenCapture, stopScreenShare, isActive } from './screen-review'

test('cancel during picker stops the late stream instead of sharing it', async () => {
  let finish!: (stream: MediaStream) => void
  let stopped = false
  const track = { stop() { stopped = true } }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getDisplayMedia: () => new Promise(resolve => { finish = resolve }) } } })
  setReviewId('review-A')
  const pending = startScreenCapture([])
  await stopScreenShare('instructor_cancelled')
  finish({ getTracks: () => [track] } as unknown as MediaStream)
  await assert.rejects(pending, /ended while choosing/)
  assert.equal(stopped, true)
  assert.equal(isActive(), false)
})
