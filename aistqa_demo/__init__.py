from flask import Flask, request, render_template, jsonify
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed
# from .calculate import answer_question


MAX_WORKERS = 5
TIMEOUT = 5

MODULE_URLS = [
    'http://localhost:5001/', # basketball
]

def fetch_answer(question, url, timeout=None):
    try:
        with requests.get(url, json={ "q": question }, timeout=timeout) as response:
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
        futures = [executor.submit(fetch_answer, question, url, TIMEOUT) for url in MODULE_URLS]
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
        return render_template('index.html')

    # curl -X POST -d 'Knicks' -H "Content-Type: text/plain" http://localhost:5000/answer
    @app.route('/answer', methods=['POST'])
    def answer():
        question = request.data.decode('utf-8')
        viable_answers = fetch_answers(question)
        return jsonify({ "viable_answers": viable_answers })

        #result = answer_question(question)
        return jsonify(answer)

    return app
