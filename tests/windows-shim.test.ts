import { expect, it } from 'vitest'
import { unwrapCmdShim } from '../packages/agents/windows-shim'

const shim = (script: string) => `@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${script}" %*\r\n`
const dir = 'C:\\Users\\a b\\AppData\\Roaming\\npm'

it('runs what an npm .cmd shim runs, without cmd.exe', () => {
  const unwrapped = unwrapCmdShim(`${dir}\\codex.cmd`, { read: () => shim('node_modules\\@openai\\codex\\bin\\codex.js'), exists: () => false })
  expect(unwrapped).toEqual({ command: 'node', prefix: [`${dir}\\node_modules\\@openai\\codex\\bin\\codex.js`] })
})

it('prefers the node.exe next to the shim, as the shim does', () => {
  const unwrapped = unwrapCmdShim(`${dir}\\claude.cmd`, { read: () => shim('node_modules\\@anthropic-ai\\claude-code\\cli.js'), exists: path => path === `${dir}\\node.exe` })
  expect(unwrapped?.command).toBe(`${dir}\\node.exe`)
})

it('runs a native program directly: Claude Code\'s npm package ships an .exe', () => {
  const native = '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n'
  expect(unwrapCmdShim(`${dir}\\claude.cmd`, { read: () => native, exists: () => false })).toEqual({ command: `${dir}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`, prefix: [] })
})

it('reads pnpm\'s shims too', () => {
  const pnpm = '@SETLOCAL\r\n@IF EXIST "%~dp0\\node.exe" (\r\n  "%~dp0\\node.exe"  "%~dp0\\..\\gemini\\dist\\index.js" %*\r\n) ELSE (\r\n  @SETLOCAL\r\n  node  "%~dp0\\..\\gemini\\dist\\index.js" %*\r\n)\r\n'
  expect(unwrapCmdShim(`${dir}\\gemini.cmd`, { read: () => pnpm, exists: () => false })).toEqual({ command: 'node', prefix: ['C:\\Users\\a b\\AppData\\Roaming\\gemini\\dist\\index.js'] })
})

it('leaves a shim for something other than node alone', () => {
  const shell = '@ECHO off\r\nSET "_prog=sh"\r\n"%_prog%"  "%dp0%\\tool" %*\r\n'
  expect(unwrapCmdShim(`${dir}\\tool.cmd`, { read: () => shell, exists: () => false })).toBeUndefined()
})

it('leaves a .cmd that is not such a shim alone', () => {
  expect(unwrapCmdShim(`${dir}\\other.cmd`, { read: () => '@echo off\r\nsomething.exe %*\r\n', exists: () => false })).toBeUndefined()
})
