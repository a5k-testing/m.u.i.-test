#####
Build
#####
..
   SPDX-FileCopyrightText: (c) 2026 ale5000
   SPDX-License-Identifier: GPL-3.0-or-later
   SPDX-FileType: DOCUMENTATION

Via `Gradle wrapper <https://docs.gradle.org/current/userguide/gradle_wrapper.html>`_
=================================================================================


Full flavour
------------

Includes all components (proprietary and open-source):

.. code-block:: sh

   ./gradlew buildOta


Open-source flavour
-------------------

Includes only open-source components:

.. code-block:: sh

   ./gradlew buildOtaOSS


Test the build
--------------

Emulates an Android recovery on the PC and runs the produced zip inside it:

.. code-block:: sh

   ./gradlew installTest

.. note::
   Run ``buildOta`` or ``buildOtaOSS`` first so that the zip exists in the ``output/`` folder.


Via ``make``
============


Full flavour
------------

Includes all components (proprietary and open-source):

.. code-block:: sh

   make buildota


Open-source flavour
-------------------

Includes only open-source components:

.. code-block:: sh

   make buildotaoss


Test the build
--------------

Emulates an Android recovery on the PC and runs the produced zip inside it:

.. code-block:: sh

   make test

.. note::
   Run ``buildota`` or ``buildotaoss`` first so that the zip exists in the ``output/`` folder.
