pipeline {
    agent any

    environment {
        // Points the backend container tests to the ephemeral pipeline db service
        DATABASE_URL = 'postgres://curaflow_user:curaflow_secure_pass@localhost:5432/curaflow_test'
    }

    stages {
        stage('Checkout Code') {
            steps {
                checkout scm
            }
        }

        stage('Backend Validation') {
            agent {
                docker {
                    image 'node:20-alpine'
                    reuseNode true
                }
            }
            steps {
                dir('curaflow-backend') {
                    sh 'npm ci'
                    // Add 'npm run lint' or 'npm test' here when your suites are ready
                }
            }
        }

        stage('Frontend Compilation Check') {
            agent {
                docker {
                    image 'node:20-alpine'
                    reuseNode true
                }
            }
            steps {
                dir('curaflow-frontend') {
                    sh 'npm ci'
                    sh 'npm run build'
                }
            }
        }

        stage('Assemble Production Containers') {
            steps {
                // Verifies your orchestration topology maps cleanly without errors
                sh 'docker compose build --parallel'
            }
        }
    }

    post {
        always {
            cleanWs()
        }
        success {
            echo '🚀 CuraFlow CI Layer verification completed successfully!'
        }
        failure {
            echo '❌ Pipeline validation breakdown detected.'
        }
    }
}