(function (window, Ractive) {
  "use strict";

  const MAX_THUMB_HEIGHT = 150;
  const MAX_THUMB_WIDTH = 200;


  // Object to hold Ractive helpers
  // (functions accessible in template)
  var helpers = Ractive.defaults.data;

  // wrap('code')('x = "&"')   becomes  '<code>x = "&amp;"</code>'
  helpers.wrap = tag => text => `<${tag}>${htmlEncode(text)}</${tag}>`;

  const isMac = navigator.platform.toLowerCase().indexOf('mac') >= 0;


  // Set up Ractive instance
  const r = new Ractive({
    el: 'content',
    template: '#content_template',
    partials: window.partials,
    data: {
      question: '',
      blocks: [],
      listening: false,
      key: {
        // characters to show modifier keys
        mod: String.fromCharCode(isMac ? 8984 : 8963),
        shift: String.fromCharCode(8679),
      },
    },
    onrender: refocus,
  });
  if (Ractive.DEBUG) window.r = r;

  // See if speech recognition engine is available
  const recognition = (function () {
    const recogClass = window.webkitSpeechRecognition || window.SpeechRecognition;
    return recogClass ? new recogClass() : null;
  })();

  if (recognition) {
    r.set('recognition', true);

    recognition.onresult = evt => {
      let transcript = evt.results[0][0].transcript;
      r.set('question', transcript).then(askQuestion);
    }

    recognition.onspeechend = evt => {
      r.set('listening', false);
      recognition.stop();
    }

    // Imitate Google's voice search shortcut (Cmd/Ctrl + Shift + .)
    document.addEventListener('keydown', evt => {
      if (evt.key == "." && evt.shiftKey && (isMac ? evt.metaKey : evt.ctrlKey)) {
        if (r.get('listening')) {
          r.set('listening', false);
          recognition.abort();
        } else {
          r.set('listening', true);
          recognition.start();
        }
        return false;
      }

      // XXX DEBUG?
      if (evt.key == 'k' && (isMac ? evt.metaKey : evt.ctrlKey)) {
        console.log("Refreshing partials");
        fetch(baseurl + '/partials')
        .then(response => response.json())
        .then(response => {
          Object.keys(response).forEach(k => r.resetPartial(k, response[k]))
          // Object.assign(r.partials, response);
          //r.unrender().then(() => r.render());
        });
      }
    });
  }





  // htmlEncode("foo & bar")   produces   "foo &amp; bar"
  const scratch = document.createElement('div');
  function htmlEncode(string) {
    scratch.textContent = string;
    return scratch.innerHTML;
  }

  // Test if the element is scrolled to the bottom
  function scrolledToBottom(element) {
    return element.scrollHeight - element.scrollTop === element.clientHeight;
  }

  // Make it so the element is scrolled to the bottom
  function scrollToBottom(element) {
    element.scrollTo(0, element.scrollHeight);
  }

  // Wrapper for any model-changing functions that need to
  // worry about whether or not to scroll the dialogue div
  // The function needs to return a Promise, as usual for Ractive
  // Typically: changeDialogue(() => r.set(...))
  function changeDialogue(fn) {
    const dialogueSection = document.querySelector('#dialogue');
    const bottom = scrolledToBottom(dialogueSection);
    fn().then(() => {
      if (bottom) {
        scrollToBottom(dialogueSection);
      }
    });
  }

  // Simulate typing by cycling between '', '.', '..' and '...'
  function simulateTyping(r) {
    let typing = r.get('typing') || '';
    if (typing.length == 3) {
      typing = "";
    } else {
      typing += ".";
    }
    r.set('typing', typing);
  }

  // Set up simulated typing
  setInterval(simulateTyping, 150, r);

  // Set up Ractive events
  r.on({
    pressKeyInQuestion: revt => {
      if (revt.event.key == "Enter") {
        askQuestion();
        return false;
      } else {
        return true;
      }
    },
    toggleDetail: function(ctx) {
      changeDialogue(() => ctx.toggle('showDetail'));
    },
    listen: () => {
      if (r.get('listening')) {
        r.set('listening', false);
        recognition.abort();
      } else {
        r.set('listening', true);
        recognition.start();
      }
      return false;
    },
    ask: ctx => {
      const question = ctx.node.textContent;
      r.set('question', question).then(askQuestion);
    }
  });

  // Handle the raw response to the question, catching errors
  function handleResponse(questionData, response) {
    if (!response.ok) {
      questionData.error = "I am sorry, something is wrong, I got confused.";
      console.error("Response not OK", response);
      changeDialogue(() => r.update('blocks'));
      return;
    }
    response.json().then(handleAnswer.bind(null, questionData));
  }

  // Handle the processed response to the question
  function handleAnswer(questionData, response) {
    if (response.viable_answers && response.viable_answers.length) {
      questionData.viable_answers = response.viable_answers.filter(Boolean);
    } else {
      questionData.error = "I didn't understand.";
    }
    // const answers = response['trial']['answer'];
    // const best = answers[0]; // XXX
    // if (best && best.length) {
    //   // There is a non-empty answer!
    //   questionData.answer = best;
    //   best.forEach(part => {
    //     if ('uri' in part) {
    //       part.uri.name = part.uri.value.replace(/.*\//, '').replace(/_/g, ' ');
    //       part.uri.wikilink = part.uri.value.replace(/.*\//, 'https://en.wikipedia.org/wiki/');
    //       fetchWikidata(questionData, part);
    //     }
    //   });
    // } else {
    //   // No answer :(
    //   questionData.error = "I don't know.";
    //   questionData.errorDetails = best ?
    //     "Answer empty." :
    //     "No answer found.";
    // }
    // const trial = response.trial;
    // questionData.questionHTML = highlightMentions(questionData.question, response.mention);
    // questionData.query = trial.query[0];
    // questionData.predicate = trial.predicate;
    // questionData.entity = trial.entity;
    // questionData.class = trial.class;
    changeDialogue(() => r.update('blocks'));
  }

  async function fetchWikidata(questionData, part) {
    const restbaseLink = 'https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(part.uri.name);
    const response = await fetch(restbaseLink, {
      method: 'GET',
      cache: 'no-cache',
      headers: {
        'Accept': 'application/json; charset=utf-8; profile="https://www.mediawiki.org/wiki/Specs/Summary/1.3.7"',
        'accept-encoding': 'gzip, deflate, br',
      },
    })
    if (response.ok) {
      part.uri.wikidata = await response.json();
      questionData.haswikidata = true;
      const t = part.uri.wikidata.thumbnail;
      if (t) {
        // avoid CSS max-height/max-width because
        // the image size isn't known till it's loaded
        // and it can mess up the dialogue scrolling
        if (t.height > MAX_THUMB_HEIGHT) {
          const ratio = t.height / MAX_THUMB_HEIGHT;
          t.height /= ratio;
          t.width /= ratio;
        }
        if (t.width > MAX_THUMB_WIDTH) {
          const ratio = t.width / MAX_THUMB_WIDTH;
          t.height /= ratio;
          t.width /= ratio;
        }
      }
      changeDialogue(() => r.update('blocks'));
    }
  }

  // Wrap any mentions into `<em>`, to the extent it is possible
  function highlightMentions(question, mentions) {
    question = htmlEncode(question);
    if (!mentions.length) {
      return question;
    }
    mentions.sort((a, b) => b.length - a.length);
    mentions.forEach(mention => {
      mention = htmlEncode(mention);
      question = question.replace(mention, `<em>${mention}</em>`);
    });
    return question;
  }

  // Post the typed (or spoken) question to the server
  function askQuestion() {
    const question = r.get('question');
    r.set('question', '');
    refocus();
    const questionData = {
      question: question,
    };
    changeDialogue(() => r.push('blocks', questionData));

    fetch(baseurl + '/answer', {
      method: 'POST',
      cache: 'no-cache',
      headers: {
        "Content-Type": "text/plain",
      },
      body: question,
    })
    .then(handleResponse.bind(null, questionData))
    .catch(response => {
      console.error(response);
      questionData.error = "Something went wrong, I got <em>very</em> confused!";
      changeDialogue(() => r.update('blocks'));
    });
    return false;
  }

  // Put focus into the question input field so users can immediately type without having to mouse around
  function refocus() {
    document.querySelector('#question').focus();
  }
})(window, Ractive);

