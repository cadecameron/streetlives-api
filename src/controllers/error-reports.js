import Joi from 'joi';
import errorReportSchemas from './validation/error-report';
import models from '../models';
import { createInstance, updateInstance, destroyInstance } from '../services/data-changes';
import slackNotifier from '../services/slack-notifier';
import { NotFoundError, ForbiddenError } from '../utils/errors';

export default {
  get: async (req, res, next) => {
    try {
      await Joi.validate(req, errorReportSchemas.get, { allowUnknown: true });

      const { locationId } = req.query;

      const publicAttributes = ['id', 'content', 'services', 'created_at'];

      const errorReports = await models.ErrorReport.findAllForLocation(locationId, {
        attributes: publicAttributes,
        order: [['created_at', 'DESC']],
      });
      res.send(errorReports);
    } catch (err) {
      next(err);
    }
  },

  create: async (req, res, next) => {
    try {
      await Joi.validate(req, errorReportSchemas.create, { allowUnknown: true });

      const {
        locationId,
        services,
        content,
        postedBy,
        contactInfo,
      } = req.body;

      const location = await models.Location.findById(locationId, { include: models.Organization });

      if (!location) {
        throw new NotFoundError('Location not found when attempting to create new error report!');
      }

      const postedErrorReport = await createInstance(
        req.user,
        location.createErrorReport.bind(location), {
          content,
          services,
          posted_by: postedBy,
          contact_info: contactInfo,
        },
      );

      try {
        await slackNotifier.notifyNewErrorReport({
          location,
          services,
          content,
          postedBy,
          contactInfo,
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Error notifying Slack of new error report!', err);
      }

      res.status(201).send(postedErrorReport);
    } catch (err) {
      next(err);
    }
  },

  delete: async (req, res, next) => {
    try {
      await Joi.validate(req, errorReportSchemas.delete, { allowUnknown: true });

      const { errorReportId } = req.params;

      const errorReport = await models.ErrorReport.findById(errorReportId, {
        include: models.Location,
      });

      if (!errorReport) {
        throw new NotFoundError('Error report not found when attempting to delete it!');
      }

      const organizationId = errorReport.Location.organization_id;

      if (!req.userOrganizationIds || !req.userOrganizationIds.includes(organizationId)) {
        throw new ForbiddenError('Not authorized to delete error reports for this organization');
      }

      await destroyInstance(req.user, errorReport);

      res.sendStatus(204);
    } catch (err) {
      next(err);
    }
  },

  setHidden: async (req, res, next) => {
    try {
      await Joi.validate(req, errorReportSchemas.setHidden, { allowUnknown: true });

      const { errorReportId } = req.params;
      const { hidden } = req.body;

      const errorReport = await models.ErrorReport.findById(errorReportId, {
        include: models.Location,
      });

      if (!errorReport) {
        throw new NotFoundError('Error report not found when attempting to make it hidden!');
      }

      if (!req.userIsAdmin) {
        throw new ForbiddenError('Not authorized to hide error report.');
      }

      await updateInstance(req.user, errorReport, { hidden });
      res.sendStatus(204);
    } catch (err) {
      next(err);
    }
  },
};
