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

it('leaves a .cmd that is not such a shim alone', () => {
  expect(unwrapCmdShim(`${dir}\\other.cmd`, { read: () => '@echo off\r\nsomething.exe %*\r\n', exists: () => false })).toBeUndefined()
})
