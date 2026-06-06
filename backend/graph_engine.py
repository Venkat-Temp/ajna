from neo4j import GraphDatabase
import logging
import os

logger = logging.getLogger(__name__)

NEO4J_URI = os.environ.get("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.environ.get("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.environ.get("NEO4J_PASSWORD", "password")

class GraphEngine:
    def __init__(self):
        try:
            self.driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
            self._ensure_indexes()
        except Exception as e:
            logger.warning("Failed to connect to Neo4j: %s", e)
            self.driver = None

    def _ensure_indexes(self):
        try:
            with self.driver.session() as session:
                for label, prop in [("User", "id"), ("Device", "id"), ("IP", "address"), ("Email", "hash")]:
                    session.run(f"CREATE INDEX IF NOT EXISTS FOR (n:{label}) ON (n.{prop})")
            logger.info("Neo4j indexes ensured for User, Device, IP, Email")
        except Exception as e:
            logger.warning("Neo4j index creation failed: %s", e)

    def close(self):
        if self.driver:
            self.driver.close()

    def update_identity_graph(self, user_id, device_id, ip_address, email_hash=None):
        if not self.driver or not user_id or not device_id:
            return

        query = """
        MERGE (u:User {id: $user_id})
        MERGE (d:Device {id: $device_id})
        MERGE (u)-[:LOGGED_IN_FROM]->(d)
        """

        if ip_address:
            query += """
            MERGE (i:IP {address: $ip_address})
            MERGE (d)-[:USED_IP]->(i)
            """

        if email_hash:
            query += """
            MERGE (e:Email {hash: $email_hash})
            MERGE (u)-[:USES_EMAIL]->(e)
            """

        try:
            with self.driver.session() as session:
                session.run(query, user_id=user_id, device_id=device_id,
                            ip_address=ip_address, email_hash=email_hash)
        except Exception as e:
            logger.error("Graph update error: %s", e)

    def get_graph_risk(self, user_id, device_id):
        if not self.driver:
            return 0, []

        risk_score = 0
        reasons = []

        try:
            with self.driver.session() as session:
                # Device shared across too many accounts (device farm / account sharing)
                result = session.run("""
                MATCH (u:User)-[:LOGGED_IN_FROM]->(d:Device {id: $device_id})
                RETURN count(DISTINCT u) as account_count
                """, device_id=device_id)
                record = result.single()
                if record:
                    account_count = record["account_count"]
                    if account_count > 5:
                        risk_score += 50
                        reasons.append(f"Device linked to {account_count} accounts (Farm suspected)")
                    elif account_count > 2:
                        risk_score += 20
                        reasons.append(f"Device linked to {account_count} accounts (Account sharing)")

                if user_id:
                    # User seen on too many devices (ATO risk)
                    result = session.run("""
                    MATCH (u:User {id: $user_id})-[:LOGGED_IN_FROM]->(d:Device)
                    RETURN count(DISTINCT d) as device_count
                    """, user_id=user_id)
                    record = result.single()
                    if record:
                        device_count = record["device_count"]
                        if device_count > 3:
                            risk_score += 15
                            reasons.append(f"User active on {device_count} devices (ATO risk)")

                    # Email shared across multiple accounts (identity fraud)
                    result = session.run("""
                    MATCH (u2:User)-[:USES_EMAIL]->(e:Email)<-[:USES_EMAIL]-(u:User {id: $user_id})
                    RETURN count(DISTINCT u2) as email_account_count
                    """, user_id=user_id)
                    record = result.single()
                    if record:
                        email_account_count = record["email_account_count"]
                        if email_account_count > 3:
                            risk_score += 20
                            reasons.append(f"Email shared by {email_account_count} accounts (identity fraud)")
                        elif email_account_count > 1:
                            risk_score += 10
                            reasons.append("Email used by multiple accounts")

        except Exception as e:
            logger.error("Graph query error: %s", e)

        return risk_score, reasons

    def get_subnet_risk(self, ip_address):
        """Check whether the /24 subnet has an unusually high account concentration."""
        if not self.driver or not ip_address:
            return 0, []

        # Extract /24 prefix — guard against malformed IPs
        try:
            parts = ip_address.split('.')
            if len(parts) != 4:
                return 0, []
            subnet = '.'.join(parts[:3]) + '.'
        except Exception:
            return 0, []

        risk_score = 0
        reasons = []

        try:
            with self.driver.session() as session:
                result = session.run("""
                MATCH (u:User)-[:LOGGED_IN_FROM]->(:Device)-[:USED_IP]->(i:IP)
                WHERE i.address STARTS WITH $subnet
                RETURN count(DISTINCT u) as subnet_user_count
                """, subnet=subnet)
                record = result.single()
                if record:
                    subnet_user_count = record["subnet_user_count"]
                    if subnet_user_count > 10:
                        risk_score += 15
                        reasons.append(f"IP subnet used by {subnet_user_count} accounts (subnet abuse)")
        except Exception as e:
            logger.error("Subnet query error: %s", e)

        return risk_score, reasons


graph_engine = GraphEngine()
