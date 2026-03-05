import {
  handleBeforeCreateOrUpdate,
  handleAfterCreateOrUpdate,
  handleBeforeDelete,
} from '../../../../extensions/custom-router/server/lifecycles';

export default {
  beforeCreate(event) {
    return handleBeforeCreateOrUpdate(event);
  },
  beforeUpdate(event) {
    return handleBeforeCreateOrUpdate(event);
  },
  afterCreate(event) {
    return handleAfterCreateOrUpdate(event);
  },
  afterUpdate(event) {
    return handleAfterCreateOrUpdate(event);
  },
  beforeDelete(event) {
    return handleBeforeDelete(event);
  },
};
