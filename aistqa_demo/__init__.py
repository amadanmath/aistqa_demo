from flask import Flask, request, render_template, jsonify
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed
# from .calculate import answer_question

from requests.adapters import HTTPAdapter
from requests.packages.urllib3.util.retry import Retry

# from https://www.peterbe.com/plog/best-practice-with-retries-with-requests
def requests_retry_session(retries=3, backoff_factor=0.3, status_forcelist=(500, 502, 504), session=None):
    session = session or requests.Session()
    retry = Retry(
        total=retries,
        read=retries,
        connect=retries,
        backoff_factor=backoff_factor,
        status_forcelist=status_forcelist,
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount('http://', adapter)
    session.mount('https://', adapter)
    return session



MAX_WORKERS = 5
TIMEOUT = 5
STARTUP_TIMEOUT = 120 # 2 minutes?
PARTIAL_RETRIES = 20

MODULES = {
    'rotowire': {
        'url': 'http://localhost:5001/',
    }
}



def fetch_partial(name, descriptor):
    try:
        print(f"Fetching partials from {name}: {descriptor['url'] + 'partials'}")
        with requests_retry_session(retries=PARTIAL_RETRIES).get(descriptor['url'] + 'partials', timeout=STARTUP_TIMEOUT) as response:
            if response.status_code == 200:
                print(f"Got partials from {name}")
                return response.json()
    except (requests.exceptions.Timeout, requests.exceptions.ConnectionError):
        pass # XXX really? if not, what? fatal error?
    return {}

def fetch_partials():
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = [executor.submit(fetch_partial, name, descriptor) for name, descriptor in MODULES.items()]
        partials = {}
        for future in as_completed(futures):
            data = future.result()
            partials.update(data)
    return partials

partials = fetch_partials()


def fetch_answer(question, name, descriptor, timeout=None):
    # XXX currently taking both name and descriptor, do we need them? or just url?
    try:
        with requests.get(descriptor['url'], json={ "q": question }, timeout=timeout) as response:
            if response.status_code != 200:
                return {
                    'error': response.text
                }

            j = response.json()
            return j
    except requests.exceptions.Timeout:
        return {
            'error': 'Timeout',
        }

def fetch_answers(question):
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = [executor.submit(fetch_answer, question, name, descriptor, TIMEOUT) for name, descriptor in MODULES.items()]
        viable = []
        for future in as_completed(futures):
            data = future.result()
            if not 'error' in data:
                viable.append(data)
    return viable

def create_app(test_config=None):
    app = Flask(__name__, instance_relative_config=True)
    app.config.from_mapping(
        SECRET_KEY='dev',
    )

    if test_config:
        app.config.from_mapping(test_config)
    else:
        try:
            app.config.from_pyfile('config.py')
        except FileNotFoundError:
            pass # meh, we can do without config

    @app.route('/')
    def index():
        return render_template('index.html', partials=partials)

    # curl -X POST -d 'Knicks' -H "Content-Type: text/plain" http://localhost:5000/answer
    @app.route('/answer', methods=['POST'])
    def answer():
        question = request.data.decode('utf-8')
        viable_answers = fetch_answers(question)
        return jsonify({ "viable_answers": viable_answers })

        #result = answer_question(question)
        return jsonify(answer)

    @app.route('/partials', methods=['GET'])
    def get_partials():
        return jsonify(fetch_partials())

    return app
