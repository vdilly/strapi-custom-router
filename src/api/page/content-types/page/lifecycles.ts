import { handleBeforeCreateOrUpdate } from '../../../../extensions/custom-router/server/lifecycles';

export default {
  beforeCreate(event) {
    return handleBeforeCreateOrUpdate(event);
  },
  beforeUpdate(event) {
    return handleBeforeCreateOrUpdate(event);
  },
};
