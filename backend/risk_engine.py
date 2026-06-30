"""Risk engine worker — blocking Redis Streams consumer.

The scoring logic now lives in scoring.py so it can be shared with the
synchronous POST /api/v1/decide endpoint in main.py. This module is the
standalone worker process: it consumes the `fraud_events` stream, scores each
event via scoring.evaluate_risk(), and publishes results to `risk_updates`.

Run as: python risk_engine.py
"""

import redis
import json
import logging
import time
import os

import scoring
from scoring import evaluate_risk  # re-exported for backward compatibility

logger = logging.getLogger(__name__)

r = redis.from_url(os.environ.get("REDIS_URL", "redis://localhost:6379/0"), decode_responses=True)

STREAM_KEY = 'fraud_events'
GROUP_NAME = 'risk_evaluators'
CONSUMER_NAME = 'worker_1'


def setup_stream():
    try:
        r.xgroup_create(STREAM_KEY, GROUP_NAME, id='0', mkstream=True)
        logger.info("Created consumer group %s on stream %s", GROUP_NAME, STREAM_KEY)
    except redis.exceptions.ResponseError as e:
        if "BUSYGROUP" in str(e):
            logger.info("Consumer group %s already exists.", GROUP_NAME)
        else:
            raise e


def start_worker():
    setup_stream()
    logger.info("Risk Engine started. Waiting for events...")

    while True:
        try:
            messages = r.xreadgroup(GROUP_NAME, CONSUMER_NAME, {STREAM_KEY: '>'}, count=10, block=2000)

            for stream, message_list in messages:
                for message_id, message in message_list:
                    event_data = json.loads(message['payload'])
                    eid = event_data.get('event_id', 'unknown')
                    etype = event_data.get('event_type', 'unknown')
                    logger.info("Evaluating event: %s [%s]", eid, etype)

                    risk_result = evaluate_risk(event_data)
                    logger.info(
                        "Score: %s (%s) | Action: %s | Session: %s | Reasons: %s",
                        risk_result['risk_score'], risk_result['category'],
                        risk_result['recommended_action'], risk_result.get('session_id'),
                        risk_result['reasons']
                    )

                    r.publish("risk_updates", json.dumps(risk_result))
                    r.xack(STREAM_KEY, GROUP_NAME, message_id)

        except Exception as e:
            logger.error("Error processing messages: %s", e)
            time.sleep(1)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(name)s %(levelname)s %(message)s")
    start_worker()
