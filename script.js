'use strict';

////////////////////////////////////////
// WORKOUT CLASSES
////////////////////////////////////////

class Workout {
    date = new Date();
    id = (Date.now() + '').slice(-10);
    clicks = 0;
    localDescription = `Unavailable`;
    marker;

    constructor(coords, distance, duration, weather) {
        this.coords = coords;       // [lat, lng]
        this.distance = distance;   // km
        this.duration = duration;   // min
        this.weather = weather;
    }

    _setDescription() {
        const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

        this.description = `${this.type[0].toUpperCase()}${this.type.slice(1)} on ${months[this.date.getMonth()]} ${this.date.getDate()}`;
    }

    _setWeatherDescription() {
        if (!this.weather) return;

        this.localDescription = `${this.weather.location.name} ${this.weather.current.temp_c} °C`;
    }

    click() {
        this.clicks++;
    }
}

class Running extends Workout {
    type = 'running';

    constructor(coords, distance, duration, cadence, weather) {
        super(coords, distance, duration, weather);
        this.cadence = cadence;
        this.calcPace();
        this._setDescription();
        this._setWeatherDescription();
    }

    calcPace() {
        // min/km
        this.pace = this.duration / this.distance;
        return this.pace;
    }
}

class Cycling extends Workout {
    type = 'cycling';

    constructor(coords, distance, duration, elevationGain) {
        super(coords, distance, duration);
        this.elevationGain = elevationGain;
        this.calcSpeed();
        this._setDescription();
    }

    calcSpeed() {
        // km/h
        this.speed = this.distance / (this.duration / 60);
        return this.speed;
    }
}

////////////////////////////////////////
// APPLICATION ARCHITECTURE
////////////////////////////////////////

const form = document.querySelector('.form');
const sidebar = document.querySelector('.sidebar');
const containerWorkouts = document.querySelector('.workouts');
const inputType = document.querySelector('.form__input--type');
const inputDistance = document.querySelector('.form__input--distance');
const inputDuration = document.querySelector('.form__input--duration');
const inputCadence = document.querySelector('.form__input--cadence');
const inputElevation = document.querySelector('.form__input--elevation');

class App {
    #map;
    #mapZoomLevel = 13;
    #mapEvent = {};
    #workouts = [];
    #markers = [];
    #sort = 'ASCENDING';
    #formTimeout;
    #weather;

    constructor () {
        // Get user's position
        this._getPosition();

        // Get data from local storage
        this._getLocalStorage();

        // Render All Workouts
        this._renderAllWorkouts();

        // Add event listeners
        this._addEventListeners();
    }

    //////////////////////////////////////
    // MAP FUNCTIONS
    //////////////////////////////////////
    _getPosition() {
        if(navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(this._loadMap.bind(this),
                // Geolocation Failed
                function() {
                    alert('Could not get your position');
                }
            );
        }
    }

    _loadMap(position) {
        // Geolocation Successful
        const { latitude } = position.coords;
        const { longitude } = position.coords;
        const coords = [latitude, longitude];

        // Load Map
        this.#map = L.map('map');

        // Center all workout points in view
        this._viewAllMarkers();

        // If there are no workouts, zoom in on current Geo location
        if (!this.#workouts.length) {
            this.#map.setView(coords, this.#mapZoomLevel);
        }

        // Instantiate Map Click
        this.#map.on('click', this._mapClick.bind(this));

        // Set Map Tiles
        L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(this.#map);

        // Render Workout Markers
        this.#workouts.forEach(work => {
            this._renderWorkoutMarker(work);
        });
    }

    async _getWeather(coords) {
        try {
            const [ lat, lng ] = coords;
            const resWeather = await fetch(`https://api.weatherapi.com/v1/current.json?key=398c4ad531d1476f87d150334220504&q=${lat},${lng}&aqi=no`);
            const dataWeather = await resWeather.json();
            this.#weather = dataWeather;
        } catch(err) {
            console.error(err);
        }
    }

    _moveToMarker(workoutEl) {
        const workout = this.#workouts.find(work => 
            work.id === workoutEl.dataset.id);

        this.#map.setView(workout.coords, this.#mapZoomLevel, {
            animate: true,
            pan: {
                duration: 1
            }
        });
    }

    _viewAllMarkers() {
        // Skip if there are no workouts
        if (!this.#workouts.length) return;

        // If there is only 1 Workout zoom in at
        // a reasonable level
        if (this.#workouts.length === 1) {
            const workout = this.#workouts[0];

            this.#map.setView(workout.coords, this.#mapZoomLevel, {
                animate: true,
                pan: {
                    duration: 1
                }
            });
            return;
        }

        // Get Highest Latitude
        const topLat = this.#workouts.reduce((prevValue, curValue) => {
            if (curValue.coords[0] > prevValue.coords[0]) return curValue;
            return prevValue;
        });
        // Get Left-most Longitude
        const leftLng = this.#workouts.reduce((prevValue, curValue) => {
            if (curValue.coords[1] < prevValue.coords[1]) return curValue;
            return prevValue;
        });

        // Get Lowest Latitude
        const bottomLat = this.#workouts.reduce((prevValue, curValue) => {
            if (curValue.coords[0] < prevValue.coords[0]) return curValue;
            return prevValue;
        });
        // Get Right-most Longitude
        const rightLng = this.#workouts.reduce((prevValue, curValue) => {
            if (curValue.coords[1] > prevValue.coords[1]) return curValue;
            return prevValue;
        });
        
        const bounds = L.latLngBounds(
            L.latLng(topLat.coords[0], leftLng.coords[1]),
            L.latLng(bottomLat.coords[0], rightLng.coords[1])
        );

        // Fit Map to Bounding Box
        this.#map.fitBounds(bounds);
    }

    //////////////////////////////////////
    // WORKOUT FUNCTIONS
    //////////////////////////////////////
    _createWorkout(e) {
        e.preventDefault();

        // Get data from the form
        const editing = form.classList.contains('editing');
        const type = inputType.value;
        const distance = +inputDistance.value;
        const duration = +inputDuration.value;
        let coords = [0,0];
        let workout;

        if (!editing) {
            const { lat, lng } = this.#mapEvent.latlng;
            coords = [lat, lng];
        }

        // If workout is running, create running object
        if (type === 'running') {
            const cadence = +inputCadence.value;

            // Check if fields are valid (numbers)
            if (!this._validateInput(inputDistance, inputDuration, inputCadence)) return;

            // Check if fields are positive
            if (!this._validatePositive(inputDistance, inputDuration, inputCadence)) return;

            workout = new Running(coords, distance, duration, cadence, this.#weather);
        }

        // If workout is cycling, create cycling object
        if (type === 'cycling') {
            const elevation = +inputElevation.value;
            
            // Check if fields are valid (numbers)
            if (!this._validateInput(inputDistance, inputDuration, inputElevation)) return;

            // Check is fields are positive
            if (!this._validatePositive(inputDistance, inputDuration)) return;
            

            workout = new Cycling(coords, distance, duration, elevation, this.#weather);
        }

        if (editing) {
            // Get Previous Workout Info
            const prevWorkoutID = form.getAttribute('data-workoutid');
            const prevWorkout = this.#workouts.find(work =>
                work.id === prevWorkoutID);
            const prevWorkoutEl = containerWorkouts.querySelector(`[data-id="${prevWorkoutID}"]`);

            // Remove element
            prevWorkoutEl.remove();

            // Remove Object from Array
            const index = this.#workouts.findIndex(work => {
                return work.id === prevWorkoutID;
            });

            // Add new/editted object to Array
            this.#workouts.splice(index, 1, workout);

            // Update Fields
            workout.id = prevWorkoutID;
            workout.coords = prevWorkout.coords;
            workout.date = new Date(prevWorkout.date);
            workout._setDescription();

        } else {
            // Add new object to end of workout array
            this.#workouts.push(workout);

            // Remove Temp Marker
            this._removeTempMarker();

            // Render workout on map as marker
            this._renderWorkoutMarker(workout);
        }

        // Show Remove All Button
        this._showRemoveAllBtn();

        // Show View All Button
        this._showViewAllBtn();

        // Render workout on list
        this._renderWorkout(workout);
        
        // Hide from + Clear input fields
        this._hideForm();

        // Set local storage to all workouts
        this._setLocalStorage();
    }

    _validateInput(...fields) {
        return fields.every(input => {
            if (!Number.isFinite(+input.value) ||
                input.value === '') {
                let message = 'Input has to be a number';
                
                if (input.value === '') message = 'Field cannot be empty';

                const html = `
                    <span class="error__message">${message}</span>
                `

                input.insertAdjacentHTML('afterend', html);

                return false;
            }
            return true;
        });
    }

    _validatePositive(...fields) {
        return fields.every(input => {
            if (+input.value <= 0) {
                const html = `
                    <span class="error__message">Input has to be greater than 0</span>
                `;
                input.insertAdjacentHTML('afterend', html);

                return false;
            }
            return true;
        });
    }

    _deleteWorkout(e) {
        const popupConfirmation = form.querySelector('.form__delete--confirmation');

        popupConfirmation.classList.remove('hidden');
        popupConfirmation.classList.add('animate');
    }

    _deleteWorkoutConfirm() {
        const workoutID = form.getAttribute('data-workoutid');
        const workout = this.#workouts.find(work => 
            work.id === workoutID);
        const workoutEl = containerWorkouts.querySelector(`[data-id="${workoutID}"]`);

        // Remove Object from Array
        const index = this.#workouts.findIndex(work => {
            return work.id === workoutID;
        });

        this.#workouts.splice(index, 1);

        // Remove marker from Array
        const i = this.#markers.findIndex(marker=> {
            return marker.workoutID === workoutID;
        })
        const marker = this.#markers[i].marker;
        marker.remove();
        this.#markers.splice(i, 1);

        // Remove Selected Workout Element
        workoutEl.remove();

        // Hide from + Clear input fields
        this._hideForm();
        //form.classList.remove('editing');

        // If there are no more Workouts,
        // Hide Remove All button and Empty Local Storage
        if (!this.#workouts.length) {
            // Hide Remove All Button
            this._hideRemoveAllBtn();

            // Empty LocalStorage
            this._emptyLocalStorage();
            return;
        }

        // Hide Delete Confirmation Popup
        const popupConfirmation = form.querySelector('.form__delete--confirmation');
        
        popupConfirmation.classList.add('hidden');

        // Set local storage to all workouts
        this._setLocalStorage();
    }

    _deleteWorkoutCancel() {
        const popupConfirmation = form.querySelector('.form__delete--confirmation');

        popupConfirmation.classList.add('hidden');
        popupConfirmation.classList.remove('quickhide');
    }

    _quickHidePopup() {
        const popupConfirmation = form.querySelector('.form__delete--confirmation');

        popupConfirmation.classList.add('quickhide');
    }

    _deleteAllWorkouts() {
        // Remove Workout Elements
        containerWorkouts.querySelectorAll('.workout').forEach(work => 
            work.remove());
        this.#workouts = [];

        // Remove Markers
        this.#markers.forEach(mark => 
            mark.marker.remove());
        this.#markers = [];

        // Hide Form
        this._hideForm();

        // Hide Confirmation Popup if it is open
        this._deleteWorkoutCancel();

        // Hide Remove all button
        this._hideRemoveAllBtn();

        // Hide View All Button
        this._hideViewAllBtn();

        // Empty LocalStorage
        this._emptyLocalStorage();
    }

    _sortWorkouts() {
        const sortBtn = sidebar.querySelector('.sort__btn');

        // IF DESCENDING
        if (this.#sort === 'DESCENDING') {
            // SORT ASCENDING
            this.#workouts.sort((a,b) => {
                return new Date(a.date) - new Date(b.date);
            });
            sortBtn.textContent = '⇵ SORT ASCENDING';
            this.#sort = 'ASCENDING';
        } else {
            // SORT DESCENDING
            this.#workouts.sort((a,b) => {
                return new Date(b.date) - new Date(a.date);
            });
            sortBtn.textContent = '⇵ SORT DESCENDING';
            this.#sort = 'DESCENDING';
        }

        // Unrender Workout List
        this._unrenderAllWorkouts();

        // Rerender Sorted Workout List
        this._renderAllWorkouts();
    }

    _showError(field, message) {
        const html = `
            <span class="error__message">${message}</span>
        `;

        field.insertAdjacentHTML('afterend', html);
    }

    _removeError() {
        const errorMessage = form.querySelector('.error__message');

        if (errorMessage){
            errorMessage.remove();
        }
    }

    //////////////////////////////////////
    // FORM FUNCTIONS
    //////////////////////////////////////
    _showForm() {
        // If timer is pending, time it out so the
        // form doesn't appear as if delayed
        if (this.#formTimeout) {
            clearTimeout(this.#formTimeout);
        }

        form.classList.remove('hidden');
        inputDistance.focus();    
    }

    _hideForm() {
        //Empty inputs
        inputDistance.value = inputDuration.value = inputCadence.value = inputElevation.value = '';

        form.classList.add('hidden');
        form.classList.remove('editing');

        // Hide remove button
        const removeBtn = form.querySelector('.form__delete');
        removeBtn.classList.add('hidden');

        // Unhide Workout items
        this._unhideWorkoutList();

        // Put Form back at the tope of the list
        containerWorkouts.prepend(form);

        // Quickly hide Confirmation Popup
        this._quickHidePopup();


        this.#formTimeout = setTimeout(() => form.style.display = 'grid', 1000);
    }

    _toggleElevationFieldOnForm() {
        inputElevation
            .closest('.form__row')
            .classList.toggle('form__row--hidden');
        inputCadence
            .closest('.form__row')
            .classList.toggle('form__row--hidden');
    }

    _editWorkoutForm(e, workoutEl) {
        const workoutEditBtn = e.target.classList.contains('workout__edit');

        if(!workoutEditBtn) return;

        this._unhideWorkoutList();

        // Remove previous temporary marker if it exists
        this._removeTempMarker();

        // Hide Delete confirmation window
        this._deleteWorkoutCancel();

        // Show remove button
        const removeBtn = form.querySelector('.form__delete');
        removeBtn.classList.remove('hidden');

        // Get Selected Workout Details
        const workout = this.#workouts.find(work => 
            work.id === workoutEl.dataset.id);
        this.#mapEvent.latlng = workout.coords;

        // Fill form details
        form.setAttribute('data-workoutid', workout.id);
        form.children[1].querySelector('input').value = workout.distance;
        form.children[2].querySelector('input').value = workout.duration;
        if (workoutEl.classList.contains('workout--running')) {
            inputElevation.closest('.form__row')
                .classList.add('form__row--hidden');
            inputCadence.closest('.form__row')
                .classList.remove('form__row--hidden');
            form.children[0].querySelector('select')
                .options[0].selected = true;
            form.children[3].querySelector('input')
                .value = workout.cadence;
        } else {
            inputElevation
                .closest('.form__row')
                .classList.remove('form__row--hidden');
            inputCadence
                .closest('.form__row')
                .classList.add('form__row--hidden');
            form.children[0].querySelector('select')
                .options[1].selected = true;
            form.children[4].querySelector('input')
                .value = workout.elevationGain;
        }

        // Move Form and Hide Selected Workout
        workoutEl.after(form);
        workoutEl.classList.add('hidden');
        form.classList.add('editing');
        this._showForm();
    }

    //////////////////////////////////////
    // RENDERING
    //////////////////////////////////////
    _tempMarker() {
        const { lat, lng } = this.#mapEvent.latlng;
        const coords = [lat, lng];
        const marker = L.marker(coords)
            .addTo(this.#map);
        
        const markerReference = {
            workoutID: 'temp',
            marker: marker
        }

        this.#markers.push(markerReference);

        this._getWeather(coords);
    }

    _renderWorkoutMarker(workout) {
        const marker = L.marker(workout.coords)
            .addTo(this.#map)
            .bindPopup(L.popup({
                maxWidth: 500,
                minWidth: 100,
                autoClose: false,
                closeOnClick: false,
                className: `${workout.type}-popup`
            }))
            .setPopupContent(`
                ${workout.type === 'running' ? '🏃‍♂️' : '🚴‍♀️'} ${workout.description}
                <br>
                📍 ${workout.localDescription}    
            `)
            .openPopup();

        const markerReference = {
            workoutID: workout.id,
            marker: marker
        }
        this.#markers.push(markerReference);
    }

    _renderWorkout(workout) {
        let html = `
            <li class="workout workout--${workout.type}" data-id="${workout.id}">
                <h2 class="workout__title">${workout.description}<span class="workout__edit">EDIT</span></h2>
                <h2 class="workout__subtitle">📍 ${workout.localDescription}</h2>
                <div class="workout__details">
                    <span class="workout__icon">${workout.type === 'running' ? '🏃‍♂️' : '🚴‍♀️'}</span>
                    <span class="workout__value form__field1">${workout.distance}</span>
                    <span class="workout__unit">km</span>
                </div>
                <div class="workout__details">
                    <span class="workout__icon">⏱</span>
                    <span class="workout__value form__field2">${workout.duration}</span>
                    <span class="workout__unit">min</span>
                </div>
        `;

        if (workout.type === 'running') {
            html += `
                <div class="workout__details">
                    <span class="workout__icon">⚡️</span>
                    <span class="workout__value form__field3">${workout.pace.toFixed(1)}</span>
                    <span class="workout__unit">min/km</span>
                </div>
                <div class="workout__details">
                    <span class="workout__icon">🦶🏼</span>
                    <span class="workout__value form__field4">${workout.cadence}</span>
                    <span class="workout__unit">spm</span>
                </div>
            </li>
            `;
        }

        if (workout.type === 'cycling') {
            html += `
                <div class="workout__details">
                    <span class="workout__icon">⚡️</span>
                    <span class="workout__value form__field3">${workout.speed.toFixed(1)}</span>
                    <span class="workout__unit">km/h</span>
                </div>
                <div class="workout__details">
                    <span class="workout__icon">⛰</span>
                    <span class="workout__value form__field4">${workout.elevationGain}</span>
                    <span class="workout__unit">m</span>
                </div>
            </li>
            `;
        }

        form.insertAdjacentHTML('afterend', html);
    }

    _renderAllWorkouts() {
        this.#workouts.forEach(work => {
            this._renderWorkout(work);
        });

        // If Workout list has items show remove all button
        if(this.#workouts.length) {
            this._showRemoveAllBtn();
            this._showViewAllBtn();
        }
    }

    _unrenderAllWorkouts() {
        containerWorkouts.querySelectorAll('.workout').forEach(work => 
            work.remove());
    }

    _unhideWorkoutList() {
        containerWorkouts.querySelectorAll('.workout').forEach(work => {
            work.classList.remove('hidden');
        });
    }

    _hideRemoveAllBtn() {
        const removeAllBtn = sidebar.querySelector('.remove__btn');
        removeAllBtn.classList.add('hidden');
    }

    _showRemoveAllBtn() {
        const removeAllBtn = sidebar.querySelector('.remove__btn');
        removeAllBtn.classList.remove('hidden');
    }

    _hideViewAllBtn() {
        const viewAllBtn = sidebar.querySelector('.view__all');
        viewAllBtn.classList.add('hidden');
    }

    _showViewAllBtn() {
        const viewAllBtn = sidebar.querySelector('.view__all');
        viewAllBtn.classList.remove('hidden');
    }

    //////////////////////////////////////
    // CLICK EVENT
    //////////////////////////////////////
    _mapClick(e) {
        this.#mapEvent = e;

        // Hide Form (if it is already open)
        this._hideForm();
        this._showForm();

        // Remove previous temporary marker if it exists
        this._removeTempMarker();

        // Add New Temporary Marker
        this._tempMarker();

        // Hide Confirmation Popup (if it is open)
        this._deleteWorkoutCancel();
    }

    _removeTempMarker() {
        const marker = this.#markers.find(mark =>
            mark.workoutID === 'temp');
        
        if (marker) {
            const index = this.#markers.findIndex(mark =>
                mark === marker);

            marker.marker.remove();
            this.#markers.splice(index, 1);
        }
    }

    _clickWorkoutListItem(e) {
        const workoutEl = e.target.closest('.workout');
        const formEl = e.target.closest('form');
        const confirmEl = e.target.closest('.form__delete--confirmation');
        // const editMode = form.classList.contains('editing');
        
        this._removeError();

        // Click on Workout Element
        if(workoutEl) {
            this._editWorkoutForm(e, workoutEl);
            this._moveToMarker(workoutEl);
            return;
        }

        // Click on Form Element
        if (e.target.classList.contains('form__delete')) {
            this._deleteWorkout(e);
        }
        
        // Click on Confirmation Box
        if (e.target.classList.contains('confirm')) {
            this._deleteWorkoutConfirm(e);
        }

        // Click on Confirmation Box
        if (e.target.classList.contains('cancel')) {
            this._deleteWorkoutCancel(e);
        }

        // Click on View All Button
        if (e.target.classList.contains('view__all')) {
            this._viewAllMarkers();
        }

        // Click on Sort Button
        if (e.target.classList.contains('sort__btn')) {
            this._sortWorkouts();
        }

        // Click on Remove All Button
        if (e.target.classList.contains('remove__btn')) {
            this._deleteAllWorkouts();
        }

        // Click anywhere else in Sidebar/Workouts section
        if (e.target.classList.contains('sidebar') ||
            e.target.classList.contains('workouts')) 
        {
            this._removeTempMarker();
            this._deleteWorkoutCancel();
            this._hideForm();
        }
    }

    //////////////////////////////////////
    // KEYBOARD EVENT
    //////////////////////////////////////
    _keyboardPressed() {
        this._removeError();
    }

    //////////////////////////////////////
    // LOCAL STORAGE
    //////////////////////////////////////
    _setLocalStorage() {
        localStorage.setItem('workouts', JSON.stringify(this.#workouts));
    }

    _getLocalStorage() {
        const data = JSON.parse(localStorage.getItem('workouts'));
        
        if (!data) return;

        // Reassign Prototype Classes to Objects
        data.forEach(work => {
            let obj;
            if (work.type === 'running') obj = new Running();
            if (work.type === 'cycling') obj = new Cycling();

            // Reassign selected Classes
            Object.assign(obj, work);

            // Push objects to new #workouts list
            this.#workouts.push(obj);
        });
    }

    _emptyLocalStorage() {
        localStorage.removeItem('workouts');
    }

    //////////////////////////////////////
    // EVENT LISTENERS
    //////////////////////////////////////
    _addEventListeners() {
        // Press ENTER on Form
        form.addEventListener('submit', this._createWorkout.bind(this));

        // Change Workout Type Field
        inputType.addEventListener('change', this._toggleElevationFieldOnForm);

        // Click within Sidebar
        sidebar.addEventListener('click', this._clickWorkoutListItem.bind(this));

        // Check for keyboard input
        document.addEventListener('keydown', this._keyboardPressed.bind(this));
    }
    
}

const app = new App();