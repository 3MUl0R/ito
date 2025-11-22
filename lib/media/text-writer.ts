import { execFile } from 'child_process'
import { platform, arch } from 'os'
import { getNativeBinaryPath } from './native-interface'

interface TextWriterOptions {
  delay: number // Delay before typing (milliseconds)
  charDelay: number // Delay between characters (milliseconds)
}

const nativeModuleName = 'text-writer'

export function setFocusedText(
  text: string,
  options: TextWriterOptions = { delay: 0, charDelay: 0 },
): Promise<boolean> {
  return new Promise(resolve => {
    const binaryPath = getNativeBinaryPath(nativeModuleName)
    if (!binaryPath) {
      console.error(
        `Cannot determine ${nativeModuleName} binary path for platform ${platform()} and arch ${arch()}`,
      )
      return resolve(false)
    }

    const args: string[] = []

    // Add optional arguments
    if (options.delay !== undefined) {
      args.push('--delay', options.delay.toString())
    }
    if (options.charDelay !== undefined) {
      args.push('--char-delay', options.charDelay.toString())
    }

    // Add the text as the final argument with -- separator to prevent flag parsing
    args.push('--', text)

    console.log('[text-writer] Spawning binary at:', binaryPath)
    const startTime = Date.now()

    execFile(binaryPath, args, (err, _stdout, stderr) => {
      const duration = Date.now() - startTime
      if (err) {
        console.error(`[text-writer] Error after ${duration}ms:`, stderr, err)
        return resolve(false)
      }
      console.log(`[text-writer] Completed successfully in ${duration}ms`)
      resolve(true)
    })
  })
}
