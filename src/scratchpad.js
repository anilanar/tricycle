import {run} from '@cycle/xstream-run';
import {makeDOMDriver, h, div} from '@cycle/dom';
import xs from 'xstream';
import delay from 'xstream/extra/delay';
import debounce from 'xstream/extra/debounce';
import sampleCombine from 'xstream/extra/sampleCombine';
// import {restart, restartable} from 'cycle-restart';

const babel = require('babel-core');
import ace from 'brace';
import 'brace/mode/javascript';
import 'brace/theme/monokai';
import 'brace/keybinding/vim';

import _ from 'lodash';

import view from './scratchpad/view';

import es2015 from 'babel-preset-es2015';

import vm from 'vm';

function transformES6 (error$) {
  return ({code}) => {
    try {
      return babel.transform(code, {presets: [es2015]});
    } catch (e) {
      error$.shamefullySendNext(e);
      return {code: ''};
    }
  };
}

function startAceEditor (code$) {
  function updateCode (editor) {
    return (_, ev) => {
      code$.shamefullySendNext({code: editor.getSession().getValue()});
    };
  }

  return ({code}) => {
    window.editor = ace.edit('editor');
    editor.getSession().setMode('ace/mode/javascript');
    editor.setTheme('ace/theme/monokai');
    editor.getSession().setOptions({
      tabSize: 2
    });

    editor.setValue(code);
    editor.clearSelection();
    editor.on('input', updateCode(editor));
  };
}

export default function Scratchpad (DOM, props) {
  let sources, sinks, drivers;

  const code$ = xs.create();

  const error$ = xs.create();

  error$.addListener({
    next (err) {
      console.log(err);
    },
    error (err) {
      console.error(err);
    },
    complete () {}
  });

  props.compose(delay(100)).addListener({
    next (v) {
      startAceEditor(code$)(v)
    },
    error (err) {
      console.error(err);
    },
    complete () {}
  });

  DOM.select('.vim-checkbox').events('change')
    .map(ev => ev.target.checked ? 'ace/keyboard/vim' : null)
    .startWith(null)
    .addListener({
      next (keyHandler) {
        if (window.editor) {
          window.editor.setKeyboardHandler(keyHandler);
        }
      },
      error (err) {
        console.error(err);
      },
      complete () {}
    });

  const restartEnabled$ = DOM.select('.instant-checkbox').events('change')
    .map(ev => ev.target.checked)
    .startWith(true);

  xs.merge(props, code$)
    .compose(debounce(300))
    .map(transformES6(error$))
    .compose(sampleCombine(restartEnabled$))
    .addListener({
      next ([{code}, restartEnabled]) {
        runOrRestart(code, restartEnabled)
      },
      error (err) {
        console.error(err);
      },
      complete () {}
    })

  function runOrRestart(code, restartEnabled) {
    if (sources) {
      sources.dispose();
    }

    if (sinks) {
      sinks.dispose();
    }

    const context = {error$, require, console};

    const wrappedCode = `
      try {
        ${code}

        error$.shamefullySendNext('');
      } catch (e) {
        error$.shamefullySendNext(e);
      }
    `;

    try {
      vm.runInNewContext(wrappedCode, context);
    } catch (e) {
      error$.shamefullySendNext(e);
    }

    if (typeof context.main !== 'function' || typeof context.sources !== 'object') {
      return;
    }

    let userApp;

    if (!drivers) {
      drivers = context.sources;
    }

    try {
      if (sources && restartEnabled) {
        // userApp = restart(context.main, drivers, {sources, sinks})
      } else {
        userApp = run(context.main, context.sources);
      }
    } catch (e) {
      error$.shamefullySendNext(e);
    }

    if (userApp) {
      sources = userApp.sources;
      sinks = userApp.sinks;
    }
  };

  const clientWidth$ = DOM.select(':root').elements().map(target => target.clientWidth);
  const mouseDown$ = DOM.select('.handler').events('mousedown');
  const mouseUp$ = DOM.select('.tricycle').events('mouseup');
  const mouseMove$ = DOM.select('.tricycle').events('mousemove');
  const mouseLeave$ = DOM.select('.tricycle').events('mouseleave');

  const MAX_RESULT_WIDTH = 0.9;
  const MIN_RESULT_WIDTH = 0.1;

  const windowSize$ = xs.combine(
      mouseDown$
        .map(mouseDown => mouseMove$.takeUntil(mouseUp$.merge(mouseLeave$)))
        .flatten(),
      // TODO: This debounce should be throttle
      clientWidth$.compose(debounce(100))
    )
    .map((mouseDrag, clientWidth) =>
      (clientWidth - mouseDrag.clientX) / clientWidth
    )
    .filter(fraction =>
      fraction < MAX_RESULT_WIDTH && fraction > MIN_RESULT_WIDTH
    )
    .map(fraction => ({
      codeWidth: `${100*(1 - fraction)}%`,
      resultWidth: `${100*fraction}%`
    }));

  return {
    DOM: xs.combine(
      xs.merge(props, windowSize$),
      error$.startWith('')
    ).map(view)
  };
}
