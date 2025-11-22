import { setFocusedText } from '../../media/text-writer'
import { timingCollector, TimingEventName } from '../timing/TimingCollector'

export class TextInserter {
  async insertText(transcript: string): Promise<boolean> {
    // If the string is empty, don't insert
    if (!transcript || !transcript.trim()) {
      return false
    }

    console.log(
      '[TextInserter] Starting text insertion:',
      transcript.substring(0, 50) + (transcript.length > 50 ? '...' : ''),
    )
    const startTime = Date.now()

    try {
      const result = await timingCollector.timeAsync(
        TimingEventName.TEXT_WRITER,
        async () => await setFocusedText(transcript),
      )
      const duration = Date.now() - startTime
      console.log(
        `[TextInserter] Text insertion completed in ${duration}ms, result:`,
        result,
      )
      return result
    } catch (error) {
      const duration = Date.now() - startTime
      console.error(
        `[TextInserter] Error inserting text after ${duration}ms:`,
        error,
      )
      return false
    }
  }
}
