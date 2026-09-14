import * as commands from '@codemirror/commands'
import * as css from '@codemirror/lang-css'
import * as html from '@codemirror/lang-html'
import * as javascript from '@codemirror/lang-javascript'
import * as json from '@codemirror/lang-json'
import * as markdown from '@codemirror/lang-markdown'
import * as python from '@codemirror/lang-python'
import * as sql from '@codemirror/lang-sql'
import * as xml from '@codemirror/lang-xml'
import * as language from '@codemirror/language'
import * as highlight from '@lezer/highlight'
import * as state from '@codemirror/state'
import * as view from '@codemirror/view'

const modules = {
  '@codemirror/commands': commands,
  '@codemirror/lang-css': css,
  '@codemirror/lang-html': html,
  '@codemirror/lang-javascript': javascript,
  '@codemirror/lang-json': json,
  '@codemirror/lang-markdown': markdown,
  '@codemirror/lang-python': python,
  '@codemirror/lang-sql': sql,
  '@codemirror/lang-xml': xml,
  '@codemirror/language': language,
  '@lezer/highlight': highlight,
  '@codemirror/state': state,
  '@codemirror/view': view,
}

for (const [id, exports] of Object.entries(modules)) {
  window.__ModuleLoader__.load({ id, factory: () => exports })
}
