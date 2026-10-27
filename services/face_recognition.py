"""
Face Recognition Service
Uses OpenCV's SFace DNN model for face embedding generation and comparison.
Generates 128-dimensional embeddings and compares faces via cosine similarity.
"""

import cv2
import numpy as np
import os
import logging

logger = logging.getLogger(__name__)

# Paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SFACE_MODEL_PATH = os.path.join(BASE_DIR, 'models', 'face_recognition_sface_2021dec.onnx')

# Global recognizer instance
_recognizer = None


def _get_recognizer():
    """Lazy-load and return the SFace recognizer."""
    global _recognizer
    if _recognizer is None:
        if not os.path.exists(SFACE_MODEL_PATH):
            raise FileNotFoundError(
                f"SFace model not found at {SFACE_MODEL_PATH}. "
                "Please download it from OpenCV's model zoo."
            )
        _recognizer = cv2.FaceRecognizerSF.create(
            model=SFACE_MODEL_PATH,
            config=''
        )
        logger.info("SFace face recognizer loaded successfully.")
    return _recognizer


def generate_embedding(image, face):
    """
    Generate a face embedding from an image and face detection result.

    Args:
        image: BGR image (numpy array).
        face: Single face row from YuNet detection (1x15 array).

    Returns:
        numpy array: 128-dimensional face embedding vector.
    """
    recognizer = _get_recognizer()

    # Align the face for better recognition accuracy
    aligned_face = recognizer.alignCrop(image, face)

    # Generate 128-d embedding
    embedding = recognizer.feature(aligned_face)

    return embedding.flatten().astype(np.float32)


def compare_embeddings(embedding1, embedding2):
    """
    Compare two face embeddings using cosine similarity.

    Args:
        embedding1: numpy array (128-d).
        embedding2: numpy array (128-d).

    Returns:
        float: Similarity score between 0.0 and 1.0 (higher = more similar).
    """
    recognizer = _get_recognizer()

    # Reshape for OpenCV's matchLevel API
    e1 = embedding1.reshape(1, -1)
    e2 = embedding2.reshape(1, -1)

    # Use cosine similarity via OpenCV
    score = recognizer.match(e1, e2, cv2.FaceRecognizerSF_FR_COSINE)

    # Clamp to [0, 1]
    score = max(0.0, min(1.0, float(score)))
    return score


def find_matches(query_embedding, stored_records, threshold=0.35):
    """
    Compare a query face embedding against all stored embeddings.

    Args:
        query_embedding: numpy array (128-d) of the query face.
        stored_records: list of dicts, each with keys:
            'embedding' (numpy array), 'identity_id', 'name', 'alias',
            'description', 'photo_path', 'confidence'
        threshold: minimum similarity to consider a match.

    Returns:
        List of match dicts sorted by similarity (highest first):
            identity_id, name, alias, description, photo_path, similarity
    """
    matches = []

    for record in stored_records:
        similarity = compare_embeddings(query_embedding, record['embedding'])

        if similarity >= threshold:
            matches.append({
                'identity_id': record['identity_id'],
                'name': record['name'],
                'alias': record.get('alias', ''),
                'description': record.get('description', ''),
                'photo_path': record.get('photo_path', ''),
                'similarity': round(similarity, 4),
            })

    matches.sort(key=lambda m: m['similarity'], reverse=True)
    return matches


def batch_generate_embeddings(image, faces):
    """
    Generate embeddings for all detected faces in an image.

    Args:
        image: BGR image (numpy array).
        faces: Faces array from YuNet detection.

    Returns:
        List of dicts, each containing:
            'embedding': numpy array (128-d)
            'bbox': [x, y, w, h]
            'confidence': detection confidence
            'landmarks': [[x,y], ...] (5 facial landmarks)
    """
    if faces is None:
        return []

    results = []
    for face in faces:
        try:
            embedding = generate_embedding(image, face)
            results.append({
                'embedding': embedding,
                'bbox': [int(face[0]), int(face[1]), int(face[2]), int(face[3])],
                'confidence': float(face[14]),
                'landmarks': face[4:14].reshape(5, 2).tolist()
            })
        except Exception as e:
            logger.warning(f"Failed to generate embedding for a face: {e}")

    return results
