"""
Real-Time Webcam Face Recognition System
Flask Application — Main Entry Point

Uses browser getUserMedia() for webcam access.
Processes frames server-side with OpenCV YuNet + SFace.

DISCLAIMER: Educational project using fictional/consenting identities only.
"""

import os
import json
import uuid
import base64
import logging
import time

import cv2
import numpy as np
from flask import Flask, render_template, request, jsonify

from services import database_service as db
from services import face_detection
from services import face_recognition as face_rec

# ── App Configuration ──────────────────────────────────────────────

app = Flask(__name__, static_folder='static', template_folder='templates')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_FOLDER = os.path.join(BASE_DIR, 'static', 'uploads')
RESULTS_FOLDER = os.path.join(BASE_DIR, 'static', 'results')
IDENTITY_PHOTOS = os.path.join(BASE_DIR, 'static', 'identity_photos')

app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16 MB

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'webp', 'bmp'}

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(name)s: %(message)s')
logger = logging.getLogger(__name__)

for folder in [UPLOAD_FOLDER, RESULTS_FOLDER, IDENTITY_PHOTOS]:
    os.makedirs(folder, exist_ok=True)


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def make_filename(original):
    ext = original.rsplit('.', 1)[1].lower()
    return f"{uuid.uuid4().hex}.{ext}"


def decode_base64_image(data_url):
    """Turn a base64 image (optionally a data: URL) into a BGR image. Returns None if invalid."""
    if ',' in data_url:
        data_url = data_url.split(',')[1]  # strip "data:image/jpeg;base64,"
    try:
        img_array = np.frombuffer(base64.b64decode(data_url), dtype=np.uint8)
        return cv2.imdecode(img_array, cv2.IMREAD_COLOR)
    except Exception:
        return None



#  PAGE ROUTE


@app.route('/')
def index():
    return render_template('index.html')



#  API — REAL-TIME FRAME PROCESSING


@app.route('/api/process-frame', methods=['POST'])
def api_process_frame():
    """
    Receive a base64-encoded webcam frame, detect faces,
    generate embeddings, match against DB, and return results.
    Optimized for real-time performance (~5-10 FPS).
    """
    data = request.get_json(silent=True)
    if not data or 'frame' not in data:
        return jsonify({'error': 'No frame data'}), 400

    try:
        t_start = time.time()

        image = decode_base64_image(data['frame'])
        if image is None:
            return jsonify({'error': 'Invalid image data'}), 400

        faces = face_detection.detect_faces_in_image(image)

        num_faces = 0 if faces is None else len(faces)

        if num_faces == 0:
            return jsonify({
                'faces_detected': 0,
                'results': [],
                'process_time_ms': round((time.time() - t_start) * 1000)
            })

        # Get stored embeddings for matching
        stored = db.get_all_embeddings()

        # Process each detected face
        results = []
        for i, face in enumerate(faces):
            bbox = [int(face[0]), int(face[1]), int(face[2]), int(face[3])]
            confidence = float(face[14])
            landmarks = face[4:14].reshape(5, 2).tolist()

            # Generate embedding
            try:
                embedding = face_rec.generate_embedding(image, face)

                # Find matches
                matches = face_rec.find_matches(embedding, stored, threshold=0.35)
            except Exception:
                matches = []

            results.append({
                'face_index': i,
                'bbox': bbox,  # [x, y, w, h]
                'confidence': round(confidence, 3),
                'landmarks': landmarks,
                'matches': matches[:3]  # top 3 matches for performance
            })

        t_elapsed = time.time() - t_start

        return jsonify({
            'faces_detected': num_faces,
            'results': results,
            'process_time_ms': round(t_elapsed * 1000)
        })

    except Exception as e:
        logger.error(f"Frame processing error: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500



#  API — IMAGE UPLOAD RECOGNITION


@app.route('/api/recognize', methods=['POST'])
def api_recognize():
    """
    Recognize faces in an uploaded image.
    Saves the upload, an annotated copy, and a crop of each face,
    then returns the top matches for every detected face.
    """
    if 'image' not in request.files:
        return jsonify({'error': 'No image uploaded.'}), 400

    file = request.files['image']
    if not file.filename or not allowed_file(file.filename):
        return jsonify({'error': 'Invalid file type. Use PNG, JPG, JPEG, WEBP or BMP.'}), 400

    filename = make_filename(file.filename)
    upload_path = os.path.join(UPLOAD_FOLDER, filename)
    file.save(upload_path)
    uploaded_url = f'/static/uploads/{filename}'

    try:
        image, faces = face_detection.detect_faces(upload_path)
    except Exception as e:
        logger.error(f"Detection error: {e}", exc_info=True)
        return jsonify({'error': f'Could not process image: {e}'}), 400

    if faces is None or len(faces) == 0:
        db.log_recognition(uploaded_url, 0, 0, [])
        return jsonify({
            'faces_detected': 0,
            'total_matches': 0,
            'uploaded_image': uploaded_url,
            'results': []
        })

    # Save annotated image
    stem = filename.rsplit('.', 1)[0]
    annotated_name = f'ann_{stem}.jpg'
    cv2.imwrite(os.path.join(RESULTS_FOLDER, annotated_name),
                face_detection.draw_detections(image, faces))

    stored = db.get_all_embeddings()
    results = []
    total_matches = 0

    for i, face in enumerate(faces):
        crop_name = f'crop_{i}_{stem}.jpg'
        cv2.imwrite(os.path.join(RESULTS_FOLDER, crop_name),
                    face_detection.crop_face(image, face))

        try:
            embedding = face_rec.generate_embedding(image, face)
            matches = face_rec.find_matches(embedding, stored, threshold=0.35)
        except Exception as e:
            logger.warning(f"Embedding/match failed for face {i + 1}: {e}")
            matches = []

        # Keep only the best match per identity, then the top 3
        best = {}
        for m in matches:
            if m['identity_id'] not in best:
                best[m['identity_id']] = m
        matches = list(best.values())[:3]

        if matches:
            total_matches += 1

        results.append({
            'face_index': i + 1,
            'bbox': [int(face[0]), int(face[1]), int(face[2]), int(face[3])],
            'detection_confidence': round(float(face[14]), 4),
            'crop_image': f'/static/results/{crop_name}',
            'matches': matches
        })

    # Save a short summary of this scan for the dashboard and Logs tab
    log_summary = [{
        'face_index': r['face_index'],
        'identity_id': r['matches'][0]['identity_id'] if r['matches'] else None,
        'top_match': r['matches'][0]['name'] if r['matches'] else None,
        'similarity': r['matches'][0]['similarity'] if r['matches'] else None
    } for r in results]
    try:
        db.log_recognition(uploaded_url, len(faces), total_matches, log_summary,
                           scan_type='upload',
                           annotated_image=f'/static/results/{annotated_name}')
    except Exception as e:
        logger.warning(f"Could not write recognition log: {e}")

    return jsonify({
        'faces_detected': len(faces),
        'total_matches': total_matches,
        'uploaded_image': uploaded_url,
        'annotated_image': f'/static/results/{annotated_name}',
        'results': results
    })



#  API — ENROLLMENT (capture face from webcam)


@app.route('/api/enroll', methods=['POST'])
def api_enroll():
    """
    Enroll a new identity from a webcam capture.
    Accepts base64 frame + name/alias/description.
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'error': 'No data provided'}), 400

    name = data.get('name', '').strip()
    alias = data.get('alias', '').strip()
    description = data.get('description', '').strip()
    frame_b64 = data.get('frame', '')

    if not name:
        return jsonify({'error': 'Name is required.'}), 400
    if not frame_b64:
        return jsonify({'error': 'No frame captured.'}), 400

    try:
        image = decode_base64_image(frame_b64)
        if image is None:
            return jsonify({'error': 'Invalid image data'}), 400

        faces = face_detection.detect_faces_in_image(image)
        if faces is None or len(faces) == 0:
            return jsonify({'error': 'No face detected in the captured frame. Please try again with your face clearly visible.'}), 400

        # Save photo (only once we know it contains a face)
        photo_filename = f"{uuid.uuid4().hex}.jpg"
        cv2.imwrite(os.path.join(IDENTITY_PHOTOS, photo_filename), image)
        photo_url = f'/static/identity_photos/{photo_filename}'

        # Create identity
        identity_id = db.add_identity(name, alias, description, photo_url)

        # Generate and store embeddings for all detected faces (usually 1)
        embedding_count = 0
        for face in faces:
            try:
                embedding = face_rec.generate_embedding(image, face)
                db.store_embedding(
                    identity_id,
                    embedding,
                    json.dumps([int(face[0]), int(face[1]), int(face[2]), int(face[3])]),
                    float(face[14])
                )
                embedding_count += 1
            except Exception as e:
                logger.warning(f"Embedding generation failed for face: {e}")

        return jsonify({
            'success': True,
            'identity_id': identity_id,
            'embeddings_generated': embedding_count,
            'photo_path': photo_url,
            'message': f'"{name}" enrolled with {embedding_count} face embedding(s).'
        })

    except Exception as e:
        logger.error(f"Enrollment error: {e}", exc_info=True)
        return jsonify({'error': f'Enrollment failed: {str(e)}'}), 500

#  API — IDENTITY MANAGEMENT (upload photo)


@app.route('/api/identities', methods=['GET'])
def api_list_identities():
    return jsonify({'identities': db.get_all_identities()})


@app.route('/api/identities', methods=['POST'])
def api_add_identity():
    """Add identity via file upload (non-webcam method)."""
    name = request.form.get('name', '').strip()
    alias = request.form.get('alias', '').strip()
    description = request.form.get('description', '').strip()

    if not name:
        return jsonify({'error': 'Name is required.'}), 400

    photo_path = ''
    saved_photo_abs = None

    if 'photo' in request.files:
        photo = request.files['photo']
        if photo.filename and allowed_file(photo.filename):
            photo_filename = make_filename(photo.filename)
            saved_photo_abs = os.path.join(IDENTITY_PHOTOS, photo_filename)
            photo.save(saved_photo_abs)
            photo_path = f'/static/identity_photos/{photo_filename}'

    identity_id = db.add_identity(name, alias, description, photo_path)

    embedding_count = 0
    if saved_photo_abs:
        try:
            image, faces = face_detection.detect_faces(saved_photo_abs)
            if faces is not None:
                for face in faces:
                    emb = face_rec.generate_embedding(image, face)
                    db.store_embedding(identity_id, emb, json.dumps([int(face[0]), int(face[1]), int(face[2]), int(face[3])]), float(face[14]))
                    embedding_count += 1
        except Exception as e:
            logger.warning(f"Embedding failed for '{name}': {e}")

    return jsonify({
        'success': True,
        'identity_id': identity_id,
        'embeddings_generated': embedding_count,
        'message': f'Identity "{name}" added with {embedding_count} embedding(s).'
    })


@app.route('/api/identities/<int:identity_id>/add-photo', methods=['POST'])
def api_add_photo(identity_id):
    """Add another photo to an existing identity to improve matching."""
    identity = db.get_identity(identity_id)
    if not identity:
        return jsonify({'error': 'Identity not found.'}), 404

    photo = request.files.get('photo')
    if not photo or not photo.filename or not allowed_file(photo.filename):
        return jsonify({'error': 'Please upload a PNG, JPG, JPEG, WEBP or BMP image.'}), 400

    photo_filename = make_filename(photo.filename)
    saved_path = os.path.join(IDENTITY_PHOTOS, photo_filename)
    photo.save(saved_path)

    try:
        image, faces = face_detection.detect_faces(saved_path)
    except Exception as e:
        os.remove(saved_path)
        return jsonify({'error': f'Could not process image: {e}'}), 400

    if faces is None or len(faces) == 0:
        os.remove(saved_path)
        return jsonify({'error': 'No face detected in this photo.'}), 400

    embedding_count = 0
    for face in faces:
        try:
            emb = face_rec.generate_embedding(image, face)
            db.store_embedding(identity_id, emb,
                               json.dumps([int(face[0]), int(face[1]), int(face[2]), int(face[3])]),
                               float(face[14]))
            embedding_count += 1
        except Exception as e:
            logger.warning(f"Embedding failed for extra photo of '{identity['name']}': {e}")

    # Use this photo as the profile picture if the identity had none
    if not identity['photo_path']:
        db.update_identity(identity_id, photo_path=f'/static/identity_photos/{photo_filename}')

    return jsonify({
        'success': True,
        'embeddings_generated': embedding_count,
        'message': f'Added {embedding_count} embedding(s) to "{identity["name"]}".'
    })


@app.route('/api/identities/<int:identity_id>', methods=['DELETE'])
def api_delete_identity(identity_id):
    identity = db.get_identity(identity_id)
    if not identity:
        return jsonify({'error': 'Identity not found.'}), 404

    if identity['photo_path']:
        abs_path = os.path.join(BASE_DIR, identity['photo_path'].lstrip('/'))
        if os.path.exists(abs_path):
            os.remove(abs_path)

    db.delete_identity(identity_id)
    return jsonify({'success': True, 'message': f'"{identity["name"]}" deleted.'})


#  API — STATS, LOGS, CLEANUP


@app.route('/api/stats', methods=['GET'])
def api_stats():
    return jsonify(db.get_stats())


@app.route('/api/logs', methods=['GET'])
def api_logs():
    return jsonify({'logs': db.get_recognition_logs(limit=100)})


@app.route('/api/logs/<int:log_id>', methods=['GET'])
def api_log_details(log_id):
    """Full details of one scan, including the matched identities' current info."""
    log = db.get_recognition_log(log_id)
    if not log:
        return jsonify({'error': 'Scan not found.'}), 404

    faces = []
    for r in log['results']:
        identity = None
        if r.get('identity_id'):
            identity = db.get_identity(r['identity_id'])
        elif r.get('top_match'):
            identity = db.find_identity_by_name(r['top_match'])  # older logs stored only the name
        faces.append({
            'face_index': r.get('face_index'),
            'matched_name': r.get('top_match'),
            'similarity': r.get('similarity'),
            'identity': identity,
            'identity_deleted': bool(r.get('top_match')) and identity is None,
        })

    log['faces'] = faces
    del log['results']
    return jsonify(log)


@app.route('/api/live-snapshot', methods=['POST'])
def api_live_snapshot():
    """Save the best-match snapshot from a live scan session as a log entry."""
    data = request.get_json(silent=True) or {}
    try:
        identity_id = int(data.get('identity_id'))
        similarity = float(data.get('similarity'))
        faces_detected = int(data.get('faces_detected') or 1)
    except (TypeError, ValueError):
        return jsonify({'error': 'Invalid snapshot data.'}), 400

    if not 0.0 <= similarity <= 1.0:
        return jsonify({'error': 'Invalid similarity.'}), 400

    identity = db.get_identity(identity_id)
    if not identity:
        return jsonify({'error': 'Identity not found.'}), 404

    image = decode_base64_image(data.get('image') or '')
    if image is None:
        return jsonify({'error': 'Invalid image data.'}), 400

    filename = f'live_{uuid.uuid4().hex}.jpg'
    cv2.imwrite(os.path.join(RESULTS_FOLDER, filename), image)
    url = f'/static/results/{filename}'

    log_id = db.log_recognition(
        url, faces_detected, 1,
        [{'face_index': 1, 'identity_id': identity_id,
          'top_match': identity['name'], 'similarity': round(similarity, 4)}],
        scan_type='live', annotated_image=url
    )
    return jsonify({'success': True, 'log_id': log_id,
                    'message': f'Best match "{identity["name"]}" ({similarity * 100:.1f}%) saved to Dashboard.'})


@app.route('/api/delete-all-data', methods=['DELETE'])
def api_delete_all():
    db.delete_all_data()
    for folder in [UPLOAD_FOLDER, RESULTS_FOLDER, IDENTITY_PHOTOS]:
        for f in os.listdir(folder):
            fp = os.path.join(folder, f)
            if os.path.isfile(fp):
                os.remove(fp)
    return jsonify({'success': True, 'message': 'All data deleted.'})



#  STARTUP


if __name__ == '__main__':
    db.init_database()
    logger.info("Database ready.")

    try:
        logger.info("Loading AI models...")
        face_detection._get_detector()
        face_rec._get_recognizer()
        logger.info("✓ All models loaded!")
    except Exception as e:
        logger.warning(f"Model pre-load issue: {e}")

    # Safe defaults: only reachable from this PC, debugger off.
    # Override with env vars, e.g. HOST=0.0.0.0 or FLASK_DEBUG=1
    host = os.environ.get('HOST', '127.0.0.1')
    debug = os.environ.get('FLASK_DEBUG', '0') == '1'
    app.run(debug=debug, host=host, port=int(os.environ.get('PORT', 5000)))
